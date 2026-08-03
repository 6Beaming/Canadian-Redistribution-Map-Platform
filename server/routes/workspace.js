import { Router } from "express";
import {
  getSupabaseAdminDataClient,
  getSupabaseProfileEmailsAsAdmin,
} from "../lib/supabase.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    res.status(403).json({ error: "Commissioner access is required." });
    return;
  }

  next();
}

router.use(requireAuth, requireCommissioner);

// REUSED DATA: commissioner identities already live in public.profiles. This
// lightweight endpoint exposes only email addresses needed by archive voting.
router.get("/reviewers", async (_req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("email")
    .eq("role", "commissioner")
    .order("email", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json((data ?? []).map((profile) => profile.email).filter(Boolean));
});

// Durable Archived Tree read. Profiles are resolved server-side so browser
// clients never need a service-role query to display commissioner emails.
router.get("/archive", async (_req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase
    .from("archive_tree")
    .select("*")
    .order("merged_at", { ascending: false });

  if (error) {
    if (error.code === "PGRST205") return res.json([]);
    return res.status(500).json({ error: error.message });
  }

  const profiles = await getSupabaseProfileEmailsAsAdmin(
    (data ?? []).flatMap((record) => [record.merged_by, record.reverted_by]).filter(Boolean),
  );
  const emailsById = new Map(profiles.map((profile) => [profile.id, profile.email]));
  return res.json((data ?? []).map((record) => ({
    ...record,
    merged_by_email: emailsById.get(record.merged_by) ?? null,
    reverted_by_email: emailsById.get(record.reverted_by) ?? null,
  })));
});

function archiveRpcError(res, error, fallbackMessage) {
  const migrationMissing = ["PGRST202", "42883"].includes(error?.code);
  const notFound = error?.code === "P0002";
  return res.status(migrationMissing ? 503 : notFound ? 404 : 500).json({
    error: migrationMissing
      ? "Archived Tree version functions are not installed. Apply supabase/migrations/20260719180000_archive_tree_supabase_versions.sql."
      : error?.message || fallbackMessage,
  });
}

// Atomic Supabase merge: snapshot, version ordering, Latest state, Workspace
// cleanup, and submission status change happen in one PostgreSQL transaction.
router.post("/archive", async (req, res) => {
  const submissionId = String(req.body?.submissionId ?? "").trim();
  if (!submissionId) {
    return res.status(400).json({ error: "submissionId is required." });
  }

  const supabase = getSupabaseAdminDataClient();
  const { data: archived, error: archiveError } = await supabase.rpc(
    "merge_submission_into_archive",
    {
      target_submission_id: submissionId,
      target_merged_by: req.user.id,
      target_closing_comment: req.body?.closingComment ?? null,
    },
  );

  if (archiveError) return archiveRpcError(res, archiveError, "Unable to merge the submission.");
  return res.status(201).json(archived);
});

// Durable Revert action: the PostgreSQL RPC atomically replaces the branch's
// single latest version and writes its revert audit fields.
router.patch("/archive/branch/latest", async (req, res) => {
  const branchKey = String(req.body?.branchKey ?? "").trim();
  const submissionId = String(req.body?.submissionId ?? "").trim();
  if (!branchKey || !submissionId) {
    return res.status(400).json({ error: "branchKey and submissionId are required." });
  }

  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase.rpc("revert_archive_branch", {
    target_branch_key: branchKey,
    target_submission_id: submissionId,
    target_reverted_by: req.user.id,
  });
  if (error) return archiveRpcError(res, error, "Unable to revert the archived branch.");
  return res.json(data);
});

// Durable destructive Delete Forever action. The RPC deletes the complete
// archived branch and its source submissions; introduce soft delete for production.
router.delete("/archive/branch", async (req, res) => {
  const branchKey = String(req.body?.branchKey ?? "").trim();
  if (!branchKey) return res.status(400).json({ error: "branchKey is required." });

  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase.rpc("delete_archive_branch", {
    target_branch_key: branchKey,
  });
  if (error) return archiveRpcError(res, error, "Unable to delete the archived branch.");
  return res.json({ deletedSubmissionIds: data ?? [] });
});

export default router;
