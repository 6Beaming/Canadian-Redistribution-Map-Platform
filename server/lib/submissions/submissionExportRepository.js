import {
  normalizeSubmissionListFilters,
  normalizeSubmissionType,
} from "./submissionListQuery.js";
import { listCommissionerSubmissionRowsV2 } from "./submissionListRepository.js";

const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 5000;

const TYPE_BUCKETS = Object.freeze({
  feedback: "comments",
  objection: "objections",
  "counter-proposal": "counterproposal",
});

function normalizeExportTypes(types = {}) {
  return {
    comments: types.comments !== false,
    objections: types.objections !== false,
    counterproposal: types.counterproposal !== false,
  };
}

function matchesEnabledTypes(row, enabledTypes) {
  const bucket = TYPE_BUCKETS[normalizeSubmissionType(row.type)] ?? "counterproposal";
  return Boolean(enabledTypes[bucket]);
}

function matchesCommunityQuery(row, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  const community = String(row.dissemination_areas?.community_name ?? "").toLowerCase();
  return community.includes(needle);
}

export function normalizeSubmissionExportRequest(body = {}) {
  const filters = normalizeSubmissionListFilters(body.filters ?? {});
  const types = normalizeExportTypes(body.types ?? {});
  const submissionIds = Array.isArray(body.submissionIds)
    ? [...new Set(body.submissionIds.map((entry) => String(entry ?? "").trim()).filter(Boolean))]
    : null;

  if (submissionIds && submissionIds.length > MAX_EXPORT_ROWS) {
    const error = new Error(`submissionIds must contain at most ${MAX_EXPORT_ROWS} IDs.`);
    error.statusCode = 400;
    throw error;
  }

  return {
    filters,
    types,
    submissionIdSet: submissionIds ? new Set(submissionIds) : null,
  };
}

export async function* iterateCommissionerExportRows(supabase, {
  actorProfile,
  filters,
  types,
  submissionIdSet = null,
}) {
  const enabledTypes = normalizeExportTypes(types);
  let cursor = null;
  let yielded = 0;

  do {
    const page = await listCommissionerSubmissionRowsV2(supabase, {
      actorProfile,
      query: {
        ...filters,
        query: "",
        pageSize: EXPORT_PAGE_SIZE,
        cursor,
      },
    });

    for (const row of page.items) {
      if (!matchesEnabledTypes(row, enabledTypes)) continue;
      if (!matchesCommunityQuery(row, filters.query)) continue;
      if (submissionIdSet && !submissionIdSet.has(String(row.id))) continue;
      yield row;
      yielded += 1;
      if (yielded >= MAX_EXPORT_ROWS) {
        return;
      }
    }

    cursor = page.page?.hasMore ? page.page.nextCursor : null;
  } while (cursor);
}
