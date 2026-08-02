import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
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

const CSV_COLUMNS = [
  { label: "Reference ID", value: (row) => row.id },
  { label: "Submitted At", value: (row) => row.created_at },
  { label: "Submitted By", value: (row) => row.authorEmail ?? "Unknown" },
  { label: "Type", value: (row) => row.type },
  { label: "Title", value: (row) => row.title },
  { label: "Community Name", value: (row) => row.dissemination_areas?.community_name ?? "Unknown" },
  { label: "Status", value: (row) => row.status },
  { label: "Primary DGUID", value: (row) => row.dguid ?? "" },
  { label: "Secondary DGUID", value: (row) => row.neighboring_dguid ?? "" },
  { label: "FED", value: (row) => row.fed_num ?? "" },
];

router.get("/submissions.csv", async (_req, res) => {
  try {
    const rows = await loadSubmissionExportRows(getSupabaseAdminDataClient());
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=commissioner-submissions.csv",
      "Cache-Control": "no-store",
    });
    return res.send(writeCsv(CSV_COLUMNS, rows));
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to export submissions." });
  }
});

router.get("/archive-tree.json", async (_req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const { data, error } = await supabase.from("archive_tree").select("*")
      .order("branch_key", { ascending: true })
      .order("version_number", { ascending: true });
    if (error && error.code !== "PGRST205") throw error;
    const rows = data ?? [];
    const branchesByKey = new Map();
    rows.forEach((row) => {
      const branchKey = row.branch_key ?? `submission:${row.submission_id}`;
      if (!branchesByKey.has(branchKey)) {
        branchesByKey.set(branchKey, { branchKey, versions: [] });
      }
      branchesByKey.get(branchKey).versions.push({
        id: row.id,
        submissionId: row.submission_id,
        versionNumber: row.version_number ?? 1,
        isLatest: Boolean(row.is_latest),
        submissionSnapshot: row.submission_snapshot,
        closingComment: row.closing_comment ?? null,
        mergedBy: row.merged_by,
        mergedAt: row.merged_at,
        revertedBy: row.reverted_by ?? null,
        revertedAt: row.reverted_at ?? null,
      });
    });
    const document = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      branches: [...branchesByKey.values()],
    };
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=archived-tree.json",
      "Cache-Control": "no-store",
    });
    return res.send(JSON.stringify(document, null, 2));
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to export the Archived Tree." });
  }
});

export default router;
