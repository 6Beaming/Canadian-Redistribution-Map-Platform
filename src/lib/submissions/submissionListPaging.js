export const SUBMISSION_LIST_UI_PAGE_SIZE = 10;
export const SUBMISSION_LIST_API_PAGE_SIZE = 25;

export function createEmptySubmissionListCache(key = "") {
  return {
    key,
    items: [],
    nextCursor: null,
    hasMore: true,
    fullyLoaded: false,
  };
}

export function buildListFiltersKey(filters = {}) {
  return JSON.stringify({
    createdFrom: filters.createdFrom ?? "",
    createdTo: filters.createdTo ?? "",
    query: filters.query ?? "",
    scope: filters.scope ?? "",
  });
}

export function needsApiFetchForUiPage(cache, targetUiPageIndex, { filterItems } = {}) {
  if (!cache) return true;

  const selectItems = filterItems ?? ((items) => items);
  const filtered = selectItems(cache.items ?? []);
  const start = targetUiPageIndex * SUBMISSION_LIST_UI_PAGE_SIZE;
  const needsMoreRows = filtered.length < start + SUBMISSION_LIST_UI_PAGE_SIZE;
  return needsMoreRows && cache.hasMore;
}

export function buildSubmissionListPageLabel({ pageIndex, totalPages, paginationSuffix }) {
  const pageNumber = pageIndex + 1;
  const suffix = paginationSuffix ?? "counting";

  if (suffix === "counting") {
    return { pageNumber, counting: true };
  }
  if (suffix === "total" && totalPages) {
    return { text: `Page ${pageNumber} of ${totalPages}` };
  }
  return { text: `Page ${pageNumber}` };
}
