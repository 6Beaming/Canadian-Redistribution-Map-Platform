import { subscribeRealtimeInvalidation } from "@/lib/realtime/realtimeInvalidation.js";
import { COMMISSIONER_TABLE_INVALIDATION_KEYS } from "@/lib/realtime/workspaceRealtime.js";

function appendFilters(url, filters = {}) {
  const params = new URLSearchParams();
  ["query", "createdFrom", "createdTo", "type", "status", "sort", "pageSize", "cursor"].forEach((key) => {
    const value = String(filters[key] ?? "").trim();
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `${url}?${query}` : url;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { credentials: "include", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export function applyCommissionerStatusVisibility(item) {
  if (!item || typeof item !== "object") return item;
  const actualStatus = item.status;
  const visibleStatus = item.visible_status ?? actualStatus;
  return {
    ...item,
    actual_status: actualStatus,
    status: visibleStatus,
    archive_request_status_hidden:
      actualStatus === "archive-request" && visibleStatus !== "archive-request",
  };
}

export async function getCommissionerSubmissionTableRows(filters = {}) {
  const payload = await requestJson(appendFilters("/api/submissions", filters));
  return {
    items: Array.isArray(payload.items)
      ? payload.items.map(applyCommissionerStatusVisibility)
      : [],
    appliedFilters: payload.appliedFilters ?? {},
    page: payload.page ?? { pageSize: payload.items?.length ?? 0, nextCursor: null, hasMore: false },
  };
}

export async function getAllCommissionerSubmissionTableRows(filters = {}, { signal, pageSize = 100 } = {}) {
  const items = [];
  let cursor = null;
  let appliedFilters = {};
  do {
    const page = await getCommissionerSubmissionTableRows({
      ...filters,
      pageSize,
      ...(cursor ? { cursor } : {}),
    });
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    items.push(...(page.items ?? []));
    appliedFilters = page.appliedFilters ?? appliedFilters;
    cursor = page.page?.hasMore ? page.page.nextCursor : null;
  } while (cursor);

  return {
    items,
    appliedFilters,
    page: { pageSize: items.length, nextCursor: null, hasMore: false },
  };
}

export async function getMySubmissionTableRows(filters = {}) {
  const payload = await requestJson(appendFilters("/api/submissions/mine", filters));
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    appliedFilters: payload.appliedFilters ?? {},
    page: payload.page ?? { pageSize: payload.items?.length ?? 0, nextCursor: null, hasMore: false },
  };
}

export async function getSubmissionTableRowById(submissionId) {
  const payload = await requestJson(
    `/api/submissions/table-row/${encodeURIComponent(submissionId)}`,
  );
  return payload.item ? applyCommissionerStatusVisibility(payload.item) : null;
}

export function subscribeCommissionerSubmissionTable({ onInvalidate, onRecover = onInvalidate }) {
  if (typeof window === "undefined") return () => {};
  const recover = (reason) => {
    void Promise.resolve(onRecover({ event: null, reason, resync: true })).catch(() => {});
  };
  const handleFocus = () => recover("focus");
  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      recover("visibility");
    }
  };
  const unsubscribeRealtime = subscribeRealtimeInvalidation(
    COMMISSIONER_TABLE_INVALIDATION_KEYS,
    onInvalidate,
  );
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibility);
  return () => {
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibility);
    unsubscribeRealtime();
  };
}
