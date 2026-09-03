import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import { streamArchiveTreeExport } from "../lib/archive/archiveExportSerializer.js";
import { filterSubmissionsForCommissionerScope } from "../lib/authorization/resourceScopeGuard.js";
import { projectArchiveRequestVisibility } from "../lib/archiveRequests/visibilityProjection.js";
import { enrichSubmissionsWithDaMetadata } from "../lib/map/submissionPresentation.js";
import {
  LIGHTWEIGHT_SUBMISSION_COLUMNS,
  serializeLightweightSubmission,
} from "../lib/submissions/submissionListQuery.js";
import { writeCsv } from "../lib/export/csvWriter.js";

const router = Router();

function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    return res.status(403).json({ error: "Commissioner access is required." });
  }
  return next();
}

router.use(requireCommissioner);

function normalizeSubmissionIds(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 5000) {
    const error = new Error("submissionIds must be an array of at most 5000 IDs.");
    error.statusCode = 400;
    throw error;
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.trim().length > 200) {
      const error = new Error("Each submission ID must be a non-empty string.");
      error.statusCode = 400;
      throw error;
    }
    return entry.trim();
  });
  return [...new Set(normalized)];
}

async function loadSubmissionExportRows(supabase, { submissionIds, actorProfile }) {
  if (!submissionIds?.length) return [];

  const CHUNK_SIZE = 100;
  const scopedRows = [];
  for (let index = 0; index < submissionIds.length; index += CHUNK_SIZE) {
    const chunk = submissionIds.slice(index, index + CHUNK_SIZE);
    const { data, error } = await supabase
      .from("submissions")
      .select(LIGHTWEIGHT_SUBMISSION_COLUMNS)
      .in("id", chunk);
    if (error) throw error;
    scopedRows.push(...await filterSubmissionsForCommissionerScope(data ?? [], actorProfile));
  }

  const enriched = await enrichSubmissionsWithDaMetadata(scopedRows);
  const projected = await projectArchiveRequestVisibility(
    supabase,
    enriched,
    actorProfile.id,
  );
  const userIds = [...new Set(projected.map((row) => row.user_id).filter(Boolean))];
  let profileById = new Map();
  if (userIds.length) {
    const { data: profiles, error: profileError } = await supabase.from("profiles")
      .select("id,email")
      .in("id", userIds);
    if (profileError) throw profileError;
    profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  }

  const rowsById = new Map(projected.map((row) => [
    String(row.id),
    serializeLightweightSubmission(row, profileById.get(row.user_id)),
  ]));
  return submissionIds.flatMap((submissionId) => rowsById.get(submissionId) ?? []);
}

async function loadSubmissionTags(supabase, submissionIds) {
  if (!submissionIds.length) return new Map();
  const { data, error } = await supabase.from("workspace_labels")
    .select("submission_id,name,is_selected,updated_at")
    .in("submission_id", submissionIds)
    .order("updated_at", { ascending: true });
  if (error) throw error;
  const tagsBySubmissionId = new Map();
  (data ?? []).filter((row) => row.is_selected !== false).forEach((row) => {
    const submissionId = String(row.submission_id);
    if (!tagsBySubmissionId.has(submissionId)) tagsBySubmissionId.set(submissionId, []);
    tagsBySubmissionId.get(submissionId).push(row.name);
  });
  return tagsBySubmissionId;
}

const CSV_COLUMNS = [
  { label: "Reference ID", value: (row) => row.id },
  { label: "Submitted At", value: (row) => row.created_at },
  { label: "Submitted By", value: (row) => row.authorEmail ?? "Unknown" },
  { label: "Type", value: (row) => row.type },
  { label: "Title", value: (row) => row.title },
  { label: "Community Name", value: (row) => row.dissemination_areas?.community_name ?? "Unknown" },
  { label: "Status", value: (row) => row.status },
  { label: "Tags", value: (row) => row.tags.join("; ") },
  { label: "Primary DGUID", value: (row) => row.dguid ?? "" },
  { label: "Secondary DGUID", value: (row) => row.neighboring_dguid ?? "" },
  { label: "FED", value: (row) => row.fed_num ?? "" },
];

async function sendSubmissionCsv(req, res) {
  try {
    const requestedIds = normalizeSubmissionIds(req.body?.submissionIds);
    if (!requestedIds?.length) {
      return res.status(400).json({ error: "submissionIds must be a non-empty array." });
    }
    const supabase = getSupabaseAdminDataClient();
    const selectedRows = await loadSubmissionExportRows(supabase, {
      submissionIds: requestedIds,
      actorProfile: req.profile,
    });
    const tagsBySubmissionId = await loadSubmissionTags(
      supabase,
      selectedRows.map((row) => String(row.id)),
    );
    const rows = selectedRows.map((row) => ({
      ...row,
      tags: tagsBySubmissionId.get(String(row.id)) ?? [],
    }));
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=commissioner-submissions.csv",
      "Cache-Control": "no-store",
    });
    return res.send(writeCsv(CSV_COLUMNS, rows));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to export submissions.",
    });
  }
}

router.get("/submissions.csv", sendSubmissionCsv);
router.post("/submissions.csv", sendSubmissionCsv);

router.get("/archive-tree.json", async (_req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    await streamArchiveTreeExport(res, supabase);
    if (!res.writableEnded) res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || "Unable to export the Archived Tree." });
    }
    res.end();
  }
});

export default router;
