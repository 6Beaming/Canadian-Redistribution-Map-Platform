import { resolveCommissionerPruid, formatCrossProvinceWarning } from "../authorization/provinceCatalog.js";
import {
  decodeSubmissionListCursor,
  encodeSubmissionListCursor,
  normalizeSubmissionListFilters,
  normalizeSubmissionListPagination,
  serializeLightweightSubmission,
} from "./submissionListQuery.js";

function rpcParams(filters, pagination, cursor) {
  return {
    p_query: filters.query,
    p_created_from: filters.createdFrom || null,
    p_created_to: filters.createdTo || null,
    p_type: filters.type,
    p_status: filters.status,
    p_sort: filters.sort,
    p_page_size: pagination.pageSize,
    p_cursor: cursor,
  };
}

function normalizeRpcRow(row) {
  const scopePruids = Array.isArray(row.scope_pruids) ? row.scope_pruids : [];
  return {
    ...row,
    cross_province_warning: formatCrossProvinceWarning(scopePruids),
  };
}

function mapRpcPayload(payload, { includeProfiles = false } = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return {
    items: items.map((row) => serializeLightweightSubmission(
      normalizeRpcRow(row),
      includeProfiles ? row.profile ?? null : null,
    )),
    page: {
      pageSize: Number(payload?.page?.pageSize) || items.length,
      nextCursor: encodeSubmissionListCursor(payload?.page?.nextCursor),
      hasMore: Boolean(payload?.page?.hasMore),
    },
  };
}

export async function listMySubmissionRowsV2(supabase, {
  userId,
  query = {},
}) {
  const filters = normalizeSubmissionListFilters(query);
  const pagination = normalizeSubmissionListPagination(query);
  const cursor = decodeSubmissionListCursor(query.cursor);
  const { data, error } = await supabase.rpc("list_my_submission_rows_v2", {
    p_user_id: userId,
    ...rpcParams(filters, pagination, cursor),
  });
  if (error) {
    throw error;
  }
  return {
    ...mapRpcPayload(data, { includeProfiles: false }),
    appliedFilters: filters,
  };
}

export async function listCommissionerSubmissionRowsV2(supabase, {
  actorProfile,
  query = {},
}) {
  const commissionerPruid = resolveCommissionerPruid(actorProfile);
  if (!commissionerPruid) {
    const error = new Error("Commissioner province registration is required.");
    error.statusCode = 403;
    throw error;
  }
  const filters = normalizeSubmissionListFilters(query);
  const pagination = normalizeSubmissionListPagination(query);
  const cursor = decodeSubmissionListCursor(query.cursor);
  const { data, error } = await supabase.rpc("list_commissioner_submission_rows_v2", {
    p_actor_id: actorProfile.id,
    p_commissioner_pruid: commissionerPruid,
    ...rpcParams(filters, pagination, cursor),
  });
  if (error) {
    throw error;
  }
  return {
    ...mapRpcPayload(data, { includeProfiles: true }),
    appliedFilters: filters,
  };
}

export async function getCommissionerSubmissionRowV2(supabase, {
  submissionId,
  actorProfile,
}) {
  const { items } = await listCommissionerSubmissionRowsV2(supabase, {
    actorProfile,
    query: {
      pageSize: 100,
      query: submissionId,
    },
  });
  return items.find((item) => String(item.id) === String(submissionId)) ?? null;
}
