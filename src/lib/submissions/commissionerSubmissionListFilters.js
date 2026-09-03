import { format, subDays } from "date-fns";

import {
  DEFAULT_VISIBLE_SUBMISSION_TYPES,
  filterSubmissionsByType,
} from "@/lib/submissions/commissionerListPaging.js";

export function formatCommissionerFilterDate(date) {
  if (!date) return "";
  return format(date, "yyyy-MM-dd");
}

export function createDefaultCommissionerTableFilters() {
  const dateEnd = new Date();
  const dateStart = subDays(dateEnd, 30);
  return {
    dateStart,
    dateEnd,
    createdFrom: formatCommissionerFilterDate(dateStart),
    createdTo: formatCommissionerFilterDate(dateEnd),
    query: "",
  };
}

export function toCommissionerActiveFilters(serverFilters) {
  return {
    createdFrom: serverFilters.createdFrom,
    createdTo: serverFilters.createdTo,
    query: serverFilters.query,
  };
}

function submissionTimestamp(submission) {
  const timestamp = new Date(submission?.created_at ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function filterCommissionerSubmissionsForTable(
  items = [],
  serverFilters = {},
  visibleTypes = DEFAULT_VISIBLE_SUBMISSION_TYPES,
) {
  const query = String(serverFilters.query ?? "").trim().toLowerCase();
  const start = serverFilters.createdFrom
    ? new Date(serverFilters.createdFrom).setHours(0, 0, 0, 0)
    : Number.NEGATIVE_INFINITY;
  const end = serverFilters.createdTo
    ? new Date(serverFilters.createdTo).setHours(23, 59, 59, 999)
    : Number.POSITIVE_INFINITY;

  return filterSubmissionsByType(items, visibleTypes)
    .filter((submission) => {
      const timestamp = submissionTimestamp(submission);
      if (timestamp < start || timestamp > end) return false;
      if (!query) return true;
      const community = String(submission?.dissemination_areas?.community_name ?? "").toLowerCase();
      return community.includes(query);
    })
    .sort((left, right) => submissionTimestamp(right) - submissionTimestamp(left));
}
