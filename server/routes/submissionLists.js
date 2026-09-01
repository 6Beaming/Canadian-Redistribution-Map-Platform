import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import { enrichSubmissionsWithDaMetadata } from "../lib/map/submissionPresentation.js";
import {
  authorizeSubmissionScope,
  filterSubmissionsForCommissionerScope,
} from "../lib/authorization/resourceScopeGuard.js";
import {
  filterAndSortSubmissionRows,
  LIGHTWEIGHT_SUBMISSION_COLUMNS,
  normalizeSubmissionListFilters,
  serializeLightweightSubmission,
} from "../lib/submissions/submissionListQuery.js";
import { projectArchiveRequestVisibility } from "../lib/archiveRequests/visibilityProjection.js";

const router = Router();

function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    return res.status(403).json({ error: "Commissioner access is required." });
  }
  return next();
}

function requirePublicUser(req, res, next) {
  if (req.profile?.role !== "public_user") {
    return res.status(403).json({ error: "Public user access is required." });
  }
  return next();
}

async function loadProfilesById(supabase, rows) {
  const ids = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("profiles").select("id,email").in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

async function presentRows(supabase, rows, { includeProfiles, actorProfileId = null }) {
  const enriched = await enrichSubmissionsWithDaMetadata(rows);
  const projected = actorProfileId
    ? await projectArchiveRequestVisibility(supabase, enriched, actorProfileId)
    : enriched;
  const profilesById = includeProfiles ? await loadProfilesById(supabase, projected) : new Map();
  return projected.map((row) => serializeLightweightSubmission(row, profilesById.get(row.user_id)));
}

async function listRows(req, res, {
  ownerId = null,
  includeProfiles = false,
  scopeToCommissioner = false,
} = {}) {
  let filters;
  try {
    filters = normalizeSubmissionListFilters(req.query);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }

  try {
    const supabase = getSupabaseAdminDataClient();
    let query = supabase.from("submissions").select(LIGHTWEIGHT_SUBMISSION_COLUMNS);
    if (ownerId) query = query.eq("user_id", ownerId);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    let scopedRows = data ?? [];
    if (scopeToCommissioner) {
      scopedRows = await filterSubmissionsForCommissionerScope(scopedRows, req.profile);
    }

    const rows = await presentRows(supabase, scopedRows, {
      includeProfiles,
      actorProfileId: scopeToCommissioner ? req.profile?.id ?? req.user?.id : null,
    });
    return res.json({
      items: filterAndSortSubmissionRows(rows, filters),
      appliedFilters: filters,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to load submissions.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

router.get("/mine", requirePublicUser, (req, res) =>
  listRows(req, res, { ownerId: req.user.id, includeProfiles: false }));

router.get("/table-row/:submissionId", requireCommissioner, async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const { data, error } = await supabase
      .from("submissions")
      .select(LIGHTWEIGHT_SUBMISSION_COLUMNS)
      .eq("id", req.params.submissionId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Submission not found." });

    try {
      const scope = await authorizeSubmissionScope(supabase, {
        submission: data,
        commissionerProfile: req.profile,
        requireClaim: false,
      });
      const [item] = await presentRows(supabase, [{
        ...data,
        scope_pruids: scope.eligibilityPruids,
        operating_pruid: scope.operatingPruid,
        cross_province_warning: scope.crossProvinceWarning,
      }], { includeProfiles: true, actorProfileId: req.profile?.id ?? req.user?.id });
      return res.json({ item });
    } catch (scopeError) {
      return res.status(scopeError.statusCode || 500).json({
        error: scopeError.message,
        ...(scopeError.code ? { code: scopeError.code } : {}),
      });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load submission." });
  }
});

router.get("/", requireCommissioner, (req, res) =>
  listRows(req, res, { includeProfiles: true, scopeToCommissioner: true }));

export default router;
