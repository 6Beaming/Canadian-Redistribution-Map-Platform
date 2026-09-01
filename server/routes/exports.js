import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import { enrichSubmissionsWithDaMetadata } from "../lib/map/submissionPresentation.js";
import { streamArchiveTreeExport } from "../lib/archive/archiveExportSerializer.js";
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

async function loadSubmissionExportRows(supabase) {
  const { data, error } = await supabase.from("submissions")
    .select(LIGHTWEIGHT_SUBMISSION_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const enriched = await enrichSubmissionsWithDaMetadata(data ?? []);
  const userIds = [...new Set(enriched.map((row) => row.user_id).filter(Boolean))];
  let profileById = new Map();
  if (userIds.length) {
    const { data: profiles, error: profileError } = await supabase.from("profiles")
      .select("id,email").in("id", userIds);
    if (profileError) throw profileError;
    profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  }
  return enriched.map((row) => serializeLightweightSubmission(row, profileById.get(row.user_id)));
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
    const supabase = getSupabaseAdminDataClient();
    const allRows = await loadSubmissionExportRows(supabase);
    const rowsById = new Map(allRows.map((row) => [String(row.id), row]));
    const selectedRows = requestedIds === null
      ? allRows
      : requestedIds.flatMap((id) => rowsById.get(id) ?? []);
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
