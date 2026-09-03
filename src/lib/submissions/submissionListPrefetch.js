import {
  buildListFiltersKey,
  createEmptySubmissionListCache,
  SUBMISSION_LIST_API_PAGE_SIZE,
} from "@/lib/submissions/submissionListPaging.js";

function normalizeApiPage(page) {
  return {
    items: Array.isArray(page.items) ? page.items : [],
    nextCursor: page.page?.nextCursor ?? null,
    hasMore: Boolean(page.page?.hasMore),
  };
}

export class SubmissionListPrefetchController {
  #drainGeneration = 0;

  #fullyLoadedResolvers = [];

  #activeFilters = null;

  #fetchPage;

  #mapItem;

  #buildFiltersKey;

  #apiPageSize;

  cache = createEmptySubmissionListCache();

  onUpdate = () => {};

  constructor({
    fetchPage,
    mapItem = (item) => item,
    buildFiltersKey = buildListFiltersKey,
    apiPageSize = SUBMISSION_LIST_API_PAGE_SIZE,
    onUpdate,
  } = {}) {
    if (!fetchPage) {
      throw new Error("SubmissionListPrefetchController requires fetchPage");
    }
    this.#fetchPage = fetchPage;
    this.#mapItem = mapItem;
    this.#buildFiltersKey = buildFiltersKey;
    this.#apiPageSize = apiPageSize;
    this.onUpdate = onUpdate ?? (() => {});
  }

  dispose() {
    this.cancelBackgroundDrain();
    this.#resolveFullyLoaded();
  }

  cancelBackgroundDrain() {
    this.#drainGeneration += 1;
  }

  async bootstrap(activeFilters = {}) {
    const filtersKey = this.#buildFiltersKey(activeFilters);
    this.cancelBackgroundDrain();
    this.cache = createEmptySubmissionListCache(filtersKey);
    this.#activeFilters = { ...activeFilters };

    const page = await this.#requestPage();
    this.#applyApiPage(page);
    this.onUpdate();

    if (this.cache.hasMore) {
      this.#startBackgroundDrain();
    } else {
      this.#markFullyLoaded();
    }

    return this.cache;
  }

  async fetchNextBatchUrgent() {
    if (!this.cache.hasMore || !this.#activeFilters) return false;

    this.cancelBackgroundDrain();
    const page = await this.#requestPage(this.cache.nextCursor);
    this.#applyApiPage(page);
    this.onUpdate();

    if (this.cache.hasMore) {
      this.#startBackgroundDrain();
    } else {
      this.#markFullyLoaded();
    }

    return true;
  }

  waitUntilFullyLoaded() {
    if (this.cache.fullyLoaded) {
      return Promise.resolve(this.cache);
    }
    return new Promise((resolve) => {
      this.#fullyLoadedResolvers.push(resolve);
    });
  }

  #requestPage(cursor = null) {
    return this.#fetchPage({
      pageSize: this.#apiPageSize,
      ...this.#activeFilters,
      ...(cursor ? { cursor } : {}),
    });
  }

  #startBackgroundDrain() {
    if (!this.#activeFilters || !this.cache.hasMore) return;
    const generation = this.#drainGeneration;
    void this.#runBackgroundDrain(generation);
  }

  async #runBackgroundDrain(generation) {
    while (
      generation === this.#drainGeneration
      && this.cache.hasMore
      && this.#activeFilters
    ) {
      try {
        const page = await this.#requestPage(this.cache.nextCursor);
        if (generation !== this.#drainGeneration) return;

        this.#applyApiPage(page);
        this.onUpdate();
      } catch {
        if (generation === this.#drainGeneration) {
          this.onUpdate();
        }
        return;
      }
    }

    if (generation === this.#drainGeneration) {
      this.#markFullyLoaded();
      this.onUpdate();
    }
  }

  #applyApiPage(page) {
    const normalized = normalizeApiPage(page);
    this.#applyRawItems(normalized.items, normalized.nextCursor, normalized.hasMore);
  }

  #applyRawItems(items, nextCursor, hasMore) {
    const mapped = (items ?? []).map((item) => this.#mapItem(item));
    this.cache.items.push(...mapped);
    this.cache.nextCursor = nextCursor;
    this.cache.hasMore = hasMore;
    this.cache.fullyLoaded = !hasMore;
  }

  #markFullyLoaded() {
    this.cache.fullyLoaded = !this.cache.hasMore;
    this.#resolveFullyLoaded();
  }

  #resolveFullyLoaded() {
    if (!this.cache.fullyLoaded) return;
    const resolvers = this.#fullyLoadedResolvers.splice(0);
    resolvers.forEach((resolve) => resolve(this.cache));
  }
}
