import {
  applyCommissionerStatusVisibility,
  getCommissionerSubmissionTableRows,
} from "@/services/submissionListsApi.js";
import { SUBMISSION_LIST_API_PAGE_SIZE } from "@/lib/submissions/submissionListPaging.js";
import {
  createDefaultCommissionerTableFilters,
  filterCommissionerSubmissionsForTable,
  parseCommissionerFilterDayBound,
} from "@/lib/submissions/commissionerSubmissionListFilters.js";

function normalizeApiPage(page) {
  return {
    items: Array.isArray(page.items) ? page.items : [],
    nextCursor: page.page?.nextCursor ?? null,
    hasMore: Boolean(page.page?.hasMore),
  };
}

export class CommissionerSubmissionListStore {
  #itemsById = new Map();

  #listeners = new Set();

  #runGeneration = 0;

  #fullyExpanded = false;

  #bootstrapping = false;

  #bootstrapPromise = null;

  /** @type {"seed" | "global"} */
  #phase = "seed";

  #seedWindow = null;

  #windowCursor = null;

  #windowHasMore = false;

  #backgroundPromise = null;

  #fullyExpandedResolvers = [];

  cache;

  constructor() {
    const store = this;
    this.cache = {
      get items() {
        return store.#getSortedItems();
      },
      get hasMore() {
        return !store.#fullyExpanded;
      },
      get fullyLoaded() {
        return store.#fullyExpanded;
      },
    };
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  isBootstrapping() {
    return this.#bootstrapping;
  }

  getItems() {
    return this.#getSortedItems();
  }

  getFilteredForTable(serverFilters, visibleTypes) {
    return filterCommissionerSubmissionsForTable(this.#getSortedItems(), serverFilters, visibleTypes);
  }

  needsMoreForTablePage(targetUiPageIndex, serverFilters, visibleTypes, pageSize) {
    const filtered = this.getFilteredForTable(serverFilters, visibleTypes);
    const needed = (targetUiPageIndex + 1) * pageSize;
    if (filtered.length >= needed) return false;
    if (this.isRangeFullyLoaded(serverFilters?.createdFrom)) return false;
    return !this.#fullyExpanded;
  }

  isRangeFullyLoaded(createdFrom) {
    if (this.#fullyExpanded) return true;
    if (!createdFrom) return false;
    const target = parseCommissionerFilterDayBound(createdFrom, { endOfDay: false });
    if (!Number.isFinite(target)) return false;
    return this.#getEarliestTimestamp() <= target;
  }

  ensureBootstrapped({ signal } = {}) {
    if (this.#bootstrapPromise) {
      return this.#bootstrapPromise;
    }

    this.#bootstrapPromise = this.#startBootstrap({ signal })
      .finally(() => {
        this.#bootstrapPromise = null;
      });

    return this.#bootstrapPromise;
  }

  async fetchNextBatchUrgent() {
    this.#cancelBackground();
    const fetched = await this.#fetchNextPage();
    if (fetched) {
      this.#notify();
    }
    this.#scheduleBackground();
    return fetched;
  }

  waitUntilFullyExpanded() {
    if (this.#fullyExpanded) {
      return Promise.resolve(this.cache);
    }
    return new Promise((resolve) => {
      this.#fullyExpandedResolvers.push(resolve);
    });
  }

  async ensureDateCoverage(createdFrom) {
    if (!createdFrom || this.#fullyExpanded) return;

    const target = parseCommissionerFilterDayBound(createdFrom, { endOfDay: false });
    if (!Number.isFinite(target)) return;

    while (!this.#fullyExpanded) {
      if (this.#getEarliestTimestamp() <= target) return;
      const fetched = await this.fetchNextBatchUrgent();
      if (!fetched) return;
    }
  }

  async reset({ signal, notifyOnInvalidate = true } = {}) {
    this.invalidate({ notify: notifyOnInvalidate });
    await this.ensureBootstrapped({ signal });
  }

  upsertItem(item, { notify = true } = {}) {
    this.#mergeItems([item]);
    if (notify) this.#notify();
  }

  removeItem(itemId, { notify = true } = {}) {
    const id = String(itemId ?? "");
    if (!id || !this.#itemsById.has(id)) return;
    this.#itemsById.delete(id);
    if (notify) this.#notify();
  }

  invalidate({ notify = true } = {}) {
    this.#cancelBackground();
    this.#itemsById.clear();
    this.#fullyExpanded = false;
    this.#phase = "seed";
    this.#seedWindow = null;
    this.#windowCursor = null;
    this.#windowHasMore = false;
    this.#bootstrapPromise = null;
    this.#bootstrapping = false;
    const resolvers = this.#fullyExpandedResolvers.splice(0);
    resolvers.forEach((resolve) => resolve(this.cache));
    if (notify) this.#notify();
  }

  #getSortedItems() {
    return [...this.#itemsById.values()].sort(
      (left, right) => new Date(right.created_at) - new Date(left.created_at),
    );
  }

  #getEarliestTimestamp() {
    const items = this.#getSortedItems();
    if (!items.length) return Number.POSITIVE_INFINITY;
    return new Date(items[items.length - 1].created_at).getTime();
  }

  #notify() {
    this.#listeners.forEach((listener) => {
      listener();
    });
  }

  #resolveFullyExpanded() {
    if (!this.#fullyExpanded) return;
    const resolvers = this.#fullyExpandedResolvers.splice(0);
    resolvers.forEach((resolve) => resolve(this.cache));
  }

  #cancelBackground() {
    this.#runGeneration += 1;
    this.#backgroundPromise = null;
  }

  #scheduleBackground() {
    if (this.#backgroundPromise || this.#fullyExpanded) return;
    const generation = this.#runGeneration;
    this.#backgroundPromise = this.#runBackground(generation)
      .catch(() => {})
      .finally(() => {
        if (this.#backgroundPromise && generation === this.#runGeneration) {
          this.#backgroundPromise = null;
        }
      });
  }

  async #startBootstrap({ signal } = {}) {
    if (this.#itemsById.size > 0) {
      this.#scheduleBackground();
      return this.cache;
    }

    this.#bootstrapping = true;
    this.#cancelBackground();
    const generation = this.#runGeneration;

    const defaults = createDefaultCommissionerTableFilters();
    this.#phase = "seed";
    this.#seedWindow = {
      createdFrom: defaults.createdFrom,
      createdTo: defaults.createdTo,
      query: "",
    };
    this.#windowCursor = null;
    this.#windowHasMore = true;

    try {
      await this.#fetchNextPage({ signal });
      if (generation !== this.#runGeneration) return this.cache;
      this.#notify();
      this.#scheduleBackground();
      return this.cache;
    } finally {
      this.#bootstrapping = false;
    }
  }

  async #runBackground(generation) {
    while (generation === this.#runGeneration && !this.#fullyExpanded) {
      const fetched = await this.#fetchNextPage();
      if (generation !== this.#runGeneration) return;
      if (fetched) {
        this.#notify();
        continue;
      }
      break;
    }
  }

  #activeRequestFilters() {
    if (this.#phase === "seed") {
      return { ...this.#seedWindow };
    }
    return { query: "" };
  }

  #beginGlobalPhase() {
    this.#phase = "global";
    this.#windowCursor = null;
    this.#windowHasMore = true;
  }

  async #fetchNextPage({ signal } = {}) {
    if (this.#fullyExpanded) return false;
    const generation = this.#runGeneration;

    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const page = await getCommissionerSubmissionTableRows({
      pageSize: SUBMISSION_LIST_API_PAGE_SIZE,
      ...this.#activeRequestFilters(),
      ...(this.#windowCursor ? { cursor: this.#windowCursor } : {}),
    });
    if (generation !== this.#runGeneration) return false;

    const normalized = normalizeApiPage(page);
    const added = this.#mergeItems(normalized.items);
    this.#windowCursor = normalized.nextCursor;
    this.#windowHasMore = normalized.hasMore;

    if (normalized.hasMore) {
      return true;
    }

    if (this.#phase === "seed") {
      this.#beginGlobalPhase();
      return this.#itemsById.size > 0;
    }

    this.#markFullyExpanded();
    return added > 0;
  }

  #markFullyExpanded() {
    this.#fullyExpanded = true;
    this.#windowHasMore = false;
    this.#resolveFullyExpanded();
  }

  #mergeItems(items) {
    let added = 0;
    for (const item of items ?? []) {
      const mapped = applyCommissionerStatusVisibility(item);
      const id = String(mapped?.id ?? "");
      if (!id) continue;
      if (!this.#itemsById.has(id)) {
        added += 1;
      }
      this.#itemsById.set(id, mapped);
    }
    return added;
  }
}

let sharedStore = null;

export function isCommissionerListSurface(pathname) {
  const path = String(pathname ?? "");
  return (
    path === "/dashboard/submissionsTable"
    || path === "/dashboard/graphs"
    || path.startsWith("/dashboard/workspace")
  );
}

export function getCommissionerSubmissionListStore() {
  if (!sharedStore) {
    sharedStore = new CommissionerSubmissionListStore();
  }
  return sharedStore;
}

export function invalidateCommissionerSubmissionListStore() {
  sharedStore?.invalidate();
}
