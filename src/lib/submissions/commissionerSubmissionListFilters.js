import { addDays, format, subDays } from "date-fns";

import {
  DEFAULT_VISIBLE_SUBMISSION_TYPES,
  filterSubmissionsByType,
} from "@/lib/submissions/commissionerListPaging.js";

export function formatCommissionerFilterDate(date) {
  if (!date) return "";
  return format(date, "yyyy-MM-dd");
}

/**
 * Parse a filter day as a local calendar boundary.
 * Date-only YYYY-MM-DD strings must not use `new Date("YYYY-MM-DD")` (UTC midnight),
 * or US timezones drop the entire local "today" from createdTo filters.
 */
export function parseCommissionerFilterDayBound(value, { endOfDay = false } = {}) {
  if (value == null || value === "") {
    return endOfDay ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }

  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    if (!Number.isFinite(copy.getTime())) {
      return endOfDay ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    if (endOfDay) copy.setHours(23, 59, 59, 999);
    else copy.setHours(0, 0, 0, 0);
    return copy.getTime();
  }

  const raw = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    return endOfDay
      ? new Date(year, month, day, 23, 59, 59, 999).getTime()
      : new Date(year, month, day, 0, 0, 0, 0).getTime();
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    return endOfDay ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  else parsed.setHours(0, 0, 0, 0);
  return parsed.getTime();
}

/** Default window: last 30 local days through today+2, covering timezone edge days. */
export const COMMISSIONER_TABLE_DEFAULT_END_PAD_DAYS = 2;

export function createDefaultCommissionerTableFilters(now = new Date()) {
  const dateStart = subDays(now, 30);
  const dateEnd = addDays(now, COMMISSIONER_TABLE_DEFAULT_END_PAD_DAYS);
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
  const start = parseCommissionerFilterDayBound(serverFilters.createdFrom, { endOfDay: false });
  const end = parseCommissionerFilterDayBound(serverFilters.createdTo, { endOfDay: true });

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
