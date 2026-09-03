import {
  buildSubmissionStatusTotals,
  normalizeAnalyticsStatus,
  SUBMISSION_STATUS_SERIES,
} from "../../../src/lib/submissions/analytics.js";
import { normalizeSubmissionListFilters, normalizeSubmissionType } from "./submissionListQuery.js";
import { listCommissionerSubmissionRowsV2 } from "./submissionListRepository.js";

function emptyTypeRecord() {
  return {
    feedback: 0,
    objection: 0,
    "counter-proposal": 0,
  };
}

function incrementTypeRecord(record, type) {
  const normalized = normalizeSubmissionType(type);
  if (normalized === "feedback") record.feedback += 1;
  else if (normalized === "objection") record.objection += 1;
  else if (normalized === "counter-proposal") record["counter-proposal"] += 1;
  return record;
}

export async function getCommissionerSubmissionAnalytics(supabase, {
  actorProfile,
  query = {},
  maxPages = 100,
} = {}) {
  const filters = normalizeSubmissionListFilters(query);
  const byType = emptyTypeRecord();
  const byStatus = buildSubmissionStatusTotals([]);
  const dailyBuckets = new Map();
  let total = 0;
  let cursor = null;
  let pagesRead = 0;

  const emptyDailyRecord = (date) => SUBMISSION_STATUS_SERIES.reduce(
    (record, series) => ({ ...record, [series.id]: 0 }),
    { date },
  );

  do {
    const page = await listCommissionerSubmissionRowsV2(supabase, {
      actorProfile,
      query: {
        ...query,
        ...filters,
        pageSize: 100,
        ...(cursor ? { cursor } : {}),
      },
    });
    pagesRead += 1;
    for (const item of page.items ?? []) {
      total += 1;
      incrementTypeRecord(byType, item.type);
      const status = normalizeAnalyticsStatus(item.status);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      const date = String(item.created_at ?? "").slice(0, 10);
      if (date) {
        if (!dailyBuckets.has(date)) {
          dailyBuckets.set(date, emptyDailyRecord(date));
        }
        const bucket = dailyBuckets.get(date);
        bucket[status] = (bucket[status] ?? 0) + 1;
      }
    }
    cursor = page.page?.hasMore ? page.page.nextCursor : null;
  } while (cursor && pagesRead < maxPages);

  return {
    total,
    byType,
    byStatus,
    daily: [...dailyBuckets.values()].sort((left, right) => left.date.localeCompare(right.date)),
    appliedFilters: filters,
    truncated: Boolean(cursor),
  };
}
