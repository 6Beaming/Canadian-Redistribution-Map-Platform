import { resolveCommissionerPruid, formatCrossProvinceWarning } from "../authorization/provinceCatalog.js";
import { authorizeSubmissionScope } from "../authorization/resourceScopeGuard.js";
import { enrichSubmissionsWithDaMetadata } from "../map/submissionPresentation.js";
import { projectArchiveRequestVisibility } from "../archiveRequests/visibilityProjection.js";
import {
  decodeSubmissionListCursor,
  encodeSubmissionListCursor,
  LIGHTWEIGHT_SUBMISSION_COLUMNS,
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

async function presentRpcPayload(supabase, payload, {
  includeProfiles = false,
  actorProfileId = null,
} = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const enriched = await enrichSubmissionsWithDaMetadata(items.map(normalizeRpcRow));
  const projected = actorProfileId
    ? await projectArchiveRequestVisibility(supabase, enriched, actorProfileId)
    : enriched;
  return mapRpcPayload({ ...payload, items: projected }, { includeProfiles });
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
    ...(await presentRpcPayload(supabase, data, { includeProfiles: false })),
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
    ...(await presentRpcPayload(supabase, data, {
      includeProfiles: true,
      actorProfileId: actorProfile.id,
    })),
    appliedFilters: filters,
  };
}

export async function getCommissionerSubmissionRowV2(supabase, {
  submissionId,
  actorProfile,
}) {
  const commissionerPruid = resolveCommissionerPruid(actorProfile);
  if (!commissionerPruid) {
    const error = new Error("Commissioner province registration is required.");
    error.statusCode = 403;
    throw error;
  }

  const { data, error } = await supabase
    .from("submissions")
    .select(LIGHTWEIGHT_SUBMISSION_COLUMNS)
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  try {
    const scope = await authorizeSubmissionScope(supabase, {
      submission: data,
      commissionerProfile: actorProfile,
      requireClaim: false,
    });
    const [enriched] = await enrichSubmissionsWithDaMetadata([{
      ...data,
      scope_pruids: scope.eligibilityPruids,
      operating_pruid: scope.operatingPruid,
      cross_province_warning: scope.crossProvinceWarning,
    }]);
    const [projected] = await projectArchiveRequestVisibility(
      supabase,
      [enriched],
      actorProfile.id,
    );
    const { data: profile } = await supabase
      .from("profiles")
      .select("id,email")
      .eq("id", projected.user_id)
      .maybeSingle();
    return serializeLightweightSubmission(projected, profile ?? null);
  } catch (scopeError) {
    if (scopeError.statusCode === 403 || scopeError.statusCode === 404) return null;
    throw scopeError;
  }
}
