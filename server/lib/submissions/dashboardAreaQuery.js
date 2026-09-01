import { resolveCommissionerPruid } from "../authorization/provinceCatalog.js";
import { normalizeSubmissionStatus, normalizeSubmissionType } from "./submissionListQuery.js";

export const DASHBOARD_AREA_SUBMISSION_COLUMNS = [
  "id",
  "type",
  "title",
  "comment",
  "user_id",
  "status",
  "dguid",
  "neighboring_dguid",
  "submission_scope_pruids!inner(pruid)",
].join(",");

const ACTIVE_DASHBOARD_STATUSES = ["pending", "archive-request"];
const DGUID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/u;

function dashboardAreaError(message, { statusCode = 500, code } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeDguid(value) {
  const dguid = String(value ?? "").trim();
  if (!DGUID_PATTERN.test(dguid)) {
    throw dashboardAreaError("A valid DGUID is required.", {
      statusCode: 400,
      code: "INVALID_DGUID",
    });
  }
  return dguid;
}

async function loadAuthorsById(supabase, rows) {
  const authorIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  if (!authorIds.length) return new Map();

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email")
    .in("id", authorIds);
  if (error) {
    throw dashboardAreaError(error.message || "Unable to load submission authors.", {
      code: "DASHBOARD_AUTHORS_FAILED",
    });
  }
  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

/**
 * Dashboard-only projection. DGUID, active-status, and Commissioner scope are
 * all applied by PostgREST before rows leave the database. Geometry and review
 * collaboration state are intentionally absent from this contract.
 */
export async function queryDashboardAreaSubmissions(supabase, {
  dguid: requestedDguid,
  commissionerProfile,
} = {}) {
  const dguid = normalizeDguid(requestedDguid);
  const commissionerPruid = resolveCommissionerPruid(commissionerProfile);
  if (!commissionerPruid) {
    throw dashboardAreaError("Commissioner province registration is required.", {
      statusCode: 403,
      code: "MISSING_COMMISSIONER_PROVINCE",
    });
  }

  const { data, error } = await supabase
    .from("submissions")
    .select(DASHBOARD_AREA_SUBMISSION_COLUMNS)
    .or(`dguid.eq.${dguid},neighboring_dguid.eq.${dguid}`)
    .eq("submission_scope_pruids.pruid", commissionerPruid)
    .in("status", ACTIVE_DASHBOARD_STATUSES)
    .order("updated_at", { ascending: false });

  if (error) {
    throw dashboardAreaError(error.message || "Unable to load Dashboard submissions.", {
      code: "DASHBOARD_AREA_QUERY_FAILED",
    });
  }

  const rows = data ?? [];
  const authorsById = await loadAuthorsById(supabase, rows);
  return {
    submissions: rows.map((row) => ({
      id: row.id,
      type: normalizeSubmissionType(row.type),
      title: row.title ?? "",
      comment: row.comment ?? "",
      author: authorsById.get(row.user_id) ?? { id: row.user_id ?? null, email: null },
      status: normalizeSubmissionStatus(row.status),
    })),
  };
}
