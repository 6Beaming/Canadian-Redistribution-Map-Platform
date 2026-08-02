import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import { enrichSubmissionsWithDaMetadata } from "../lib/map/submissionPresentation.js";
import {
  filterAndSortSubmissionRows,
  LIGHTWEIGHT_SUBMISSION_COLUMNS,
  normalizeSubmissionListFilters,
  serializeLightweightSubmission,
} from "../lib/submissions/submissionListQuery.js";

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

async function presentRows(supabase, rows, { includeProfiles }) {
  const enriched = await enrichSubmissionsWithDaMetadata(rows);
  const profilesById = includeProfiles ? await loadProfilesById(supabase, enriched) : new Map();
  return enriched.map((row) => serializeLightweightSubmission(row, profilesById.get(row.user_id)));
}

async function listRows(req, res, { ownerId = null, includeProfiles = false } = {}) {
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
    const rows = await presentRows(supabase, data ?? [], { includeProfiles });
    return res.json({ items: filterAndSortSubmissionRows(rows, filters), appliedFilters: filters });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load submissions." });
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
    const [item] = await presentRows(supabase, [data], { includeProfiles: true });
    return res.json({ item });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load submission." });
  }
});

router.get("/", requireCommissioner, (req, res) =>
  listRows(req, res, { includeProfiles: true }));

export default router;
