export const COMMISSIONER_UI_PAGE_SIZE = 10;
export const COMMISSIONER_API_PAGE_SIZE = 25;

export {
  SUBMISSION_LIST_UI_PAGE_SIZE,
  SUBMISSION_LIST_API_PAGE_SIZE,
  createEmptySubmissionListCache,
  buildSubmissionListPageLabel,
} from "@/lib/submissions/submissionListPaging.js";

import {
  needsApiFetchForUiPage as needsApiFetchForUiPageBase,
  createEmptySubmissionListCache,
} from "@/lib/submissions/submissionListPaging.js";

export function getSubmissionTypeBucket(type) {
  const normalized = String(type ?? "").trim().toLowerCase().replaceAll("-", "_");

  if (["feedback", "comment", "comments"].includes(normalized)) return "comments";
  if (["objection", "objections"].includes(normalized)) return "objections";
  return "counterproposal";
}

export const DEFAULT_VISIBLE_SUBMISSION_TYPES = Object.freeze({
  comments: true,
  objections: true,
  counterproposal: true,
});

export function areAllSubmissionTypesVisible(visibleTypes = DEFAULT_VISIBLE_SUBMISSION_TYPES) {
  return visibleTypes.comments && visibleTypes.objections && visibleTypes.counterproposal;
}

export function filterSubmissionsByType(
  submissions = [],
  visibleTypes = DEFAULT_VISIBLE_SUBMISSION_TYPES,
) {
  return submissions.filter((submission) => (
    visibleTypes[getSubmissionTypeBucket(submission.type)]
  ));
}

export function buildCommissionerListFiltersKey(filters = {}) {
  return JSON.stringify({
    createdFrom: filters.createdFrom ?? "",
    createdTo: filters.createdTo ?? "",
    query: filters.query ?? "",
  });
}

export function createEmptyCommissionerListCache(key = "") {
  return createEmptySubmissionListCache(key);
}

export function needsApiFetchForUiPage(cache, targetUiPageIndex, visibleTypes) {
  return needsApiFetchForUiPageBase(cache, targetUiPageIndex, {
    filterItems: (items) => filterSubmissionsByType(items, visibleTypes),
  });
}
