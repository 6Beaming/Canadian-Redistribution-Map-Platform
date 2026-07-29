import { Router } from "express";
import {
  getSupabaseAdminDataClient,
  getSupabaseClient,
  getSupabaseProfileEmailsAsAdmin,
} from "../lib/supabase.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const WORKSPACE_STATUSES = new Set([
  "pending",
  "archive-request",
  "accepted",
  "rejected",
  "archived",
]);

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

// TEMPORARY HARD API: status writes belong in a dedicated submission domain
// service once the Workspace backend is split from the demo Express server.
router.patch("/submissions/:submissionId/status", async (req, res) => {
  const status = String(req.body?.status ?? "").trim().toLowerCase();
  if (!WORKSPACE_STATUSES.has(status)) {
    return res.status(400).json({ error: "Unsupported workspace status." });
  }

  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase
    .from("submissions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", req.params.submissionId)
    .select("*")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Submission not found." });
  return res.json(data);
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

// Add a workspace comment to a user submission
router.post("/comments/", async (req, res) => {


  const supabase = getSupabaseClient();
  const user_id = req.user.id;
  const { submissionId, content, action, is_closing } = req.body;

  // Verify comment exists
  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .single();


  if (submissionError || !submission) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const { data, error } = await supabase
    .from("workspace_comments")
    .insert([{
      submission_id: submissionId,
      author_id: user_id,
      content: content,
      action: action,
      is_closing: is_closing
    }])
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: "unable to add workspace comment" });
  }

  return res.status(201).json(data);
});


// Get workspace comments for a submission
router.get("/comments/:submissionId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { submissionId } = req.params;

  const { data, error } = await supabase
    .from("workspace_comments")
    .select(`
    id,
    content,
    action,
    is_closing,
    created_at,
    author_id,
    profiles!author_id (
      email
    )
  `)
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({
      error: "Unable to get workspace comments."
    });
  }

  const comments = data.map((comment) => ({
    id: comment.id,
    content: comment.content,
    action: comment.action,
    isClosing: comment.is_closing,
    createdAt: comment.created_at,
    email: comment.profiles?.email ?? "Unknown",
  }));

  return res.status(200).json(comments);
});

// Save workspace labels for a submission
router.post("/labels/:submissionId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { submissionId } = req.params;
  const { labels } = req.body;
  const user_id = req.user.id;


  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .single();


  if (submissionError || !submission) {
    return res.status(404).json({
      error: "Submission not found."
    });
  }

  // remove old labels
  await supabase
    .from("workspace_labels")
    .delete()
    .eq("submission_id", submissionId);


  if (!labels || labels.length === 0) {
    return res.status(201).json([]);
  }


  const rows = labels.map((label) => ({
    submission_id: submissionId,
    name: label.name,
    color: label.color,
    is_custom: label.custom,
    updated_by: user_id,
  }));


  const { data, error } = await supabase
    .from("workspace_labels")
    .insert(rows)
    .select();


  if (error) {
    return res.status(500).json({
      error: "Unable to save workspace labels."
    });
  }


  return res.status(201).json(data);
});

// Get labels for a submission
router.get("/labels/:submissionId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { submissionId } = req.params;


  const { data, error } = await supabase
    .from("workspace_labels")
    .select("*")
    .eq("submission_id", submissionId);


  if (error) {
    return res.status(500).json({
      error: "Unable to get workspace labels."
    });
  }


  const labels = data.map((label) => ({
    id: label.label_id,
    name: label.name,
    color: label.color,
    custom: label.custom
  }));


  return res.status(200).json(labels);
});

// Create archive request
router.post("/archive-requests/:submissionId", async (req, res) => {
  const supabase = getSupabaseClient();

  const requesterId = req.user.id;
  const { submissionId } = req.params;
  const { assignees } = req.body;


  const { data: submission } = await supabase
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .single();


  if (!submission) {
    return res.status(404).json({
      error: "Submission not found."
    });
  }


  // Convert assignee emails -> profile UUIDs
  const normalizedEmails = [
    ...new Set(
      (assignees ?? [])
        .map((email) => String(email).trim())
        .filter(Boolean)
    )
  ];


  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,email")
    .in("email", normalizedEmails);


  if (profileError) {
    return res.status(500).json({
      error: "Unable to resolve assignees."
    });
  }


  const assigneeIds = profiles.map((profile) => profile.id);


  const requesterEmail = req.profile.email;


  const { data, error } = await supabase
    .from("workspace_archive_requests")
    .insert({
      submission_id: submissionId,
      requester_id: requesterId,
      assignee_ids: assigneeIds,
      votes: {
        [requesterEmail]: "accepted"
      }
    })
    .select()
    .single();


  if (error) {
    console.error(error);
    return res.status(500).json({
      error: "Unable to create archive request."
    });
  }


  return res.status(201).json(data);
});



// Get archive request
router.get("/archive-requests/:submissionId", async (req, res) => {

  const supabase = getSupabaseClient();
  const { submissionId } = req.params;


  const { data, error } = await supabase
    .from("workspace_archive_requests")
    .select(`
      *,
      requester:profiles!requester_id(
        email
      )
    `)
    .eq("submission_id", submissionId)
    .maybeSingle();


  if (error) {
    return res.status(500).json({
      error: error.message
    });
  }


  if (!data) {
    return res.status(200).json(null);
  }


  // Resolve assignee UUIDs -> emails
  const { data: assigneeProfiles } = await supabase
    .from("profiles")
    .select("id,email")
    .in("id", data.assignee_ids ?? []);


  return res.status(200).json({
    requesterEmail: data.requester?.email ?? null,

    assignees: (assigneeProfiles ?? [])
      .map((profile) => profile.email)
      .filter(Boolean),

    votes: data.votes ?? {},

    createdAt: data.created_at
  });
});



// A commissioner votes for an archive request
router.patch("/archive-requests/:submissionId/vote", async (req, res) => {

  const supabase = getSupabaseClient();

  const userEmail = req.profile.email;

  const { submissionId } = req.params;
  const { vote } = req.body;


  const { data: request, error } = await supabase
    .from("workspace_archive_requests")
    .select("votes")
    .eq("submission_id", submissionId)
    .single();


  if (error || !request) {
    return res.status(404).json({
      error: "Archive request not found."
    });
  }


  const updatedVotes = {
    ...(request.votes ?? {}),
    [userEmail]: vote
  };


  const { data, error: updateError } = await supabase
    .from("workspace_archive_requests")
    .update({
      votes: updatedVotes,
      updated_at: new Date().toISOString()
    })
    .eq("submission_id", submissionId)
    .select()
    .single();


  if (updateError) {
    return res.status(500).json({
      error: "Unable to update vote."
    });
  }


  return res.status(200).json(data);
});



// Update archive request assignees
router.patch("/archive-requests/:submissionId/assignees", async (req, res) => {

  const supabase = getSupabaseClient();

  const userEmail = req.profile.email;

  const { submissionId } = req.params;
  const { assignees } = req.body;


  const { data: request, error } = await supabase
    .from("workspace_archive_requests")
    .select(`
      requester_id,
      assignee_ids,
      votes
    `)
    .eq("submission_id", submissionId)
    .single();


  if (error || !request) {
    return res.status(404).json({
      error: "Archive request not found."
    });
  }


  const { data: requester } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", request.requester_id)
    .single();


  if (requester?.email !== userEmail) {
    return res.status(403).json({
      error: "Only the requester can update assignees."
    });
  }


  // Convert emails -> UUIDs
  const normalizedEmails = [
    ...new Set(
      (assignees ?? [])
        .map((email) => String(email).trim())
        .filter(Boolean)
    )
  ];


  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,email")
    .in("email", normalizedEmails);


  const assigneeIds = profiles.map((profile) => profile.id);

  // Keep votes only from current assignees + requester
  const updatedVotes = Object.fromEntries(
    Object.entries(request.votes ?? {}).filter(([email]) =>
      normalizedEmails.includes(email) ||
      email === userEmail
    )
  );


  const { data, error: updateError } = await supabase
    .from("workspace_archive_requests")
    .update({
      assignee_ids: assigneeIds,
      votes: updatedVotes,
      updated_at: new Date().toISOString()
    })
    .eq("submission_id", submissionId)
    .select()
    .single();


  if (updateError) {
    return res.status(500).json({
      error: "Unable to update archive assignees."
    });
  }


  return res.status(200).json(data);
});



// Cancel archive request
router.delete("/archive-requests/:submissionId", async (req, res) => {

  const supabase = getSupabaseClient();

  const userId = req.user.id;

  const { submissionId } = req.params;


  const { data: request, error } = await supabase
    .from("workspace_archive_requests")
    .select("requester_id")
    .eq("submission_id", submissionId)
    .single();


  if (error || !request) {
    return res.status(404).json({
      error: "Archive request not found."
    });
  }


  if (request.requester_id !== userId) {
    return res.status(403).json({
      error: "Only the requester can cancel this archive request."
    });
  }


  const { error: deleteError } = await supabase
    .from("workspace_archive_requests")
    .delete()
    .eq("submission_id", submissionId);


  if (deleteError) {
    return res.status(500).json({
      error: "Unable to cancel archive request."
    });
  }


  return res.status(200).json({
    message: "Archive request cancelled."
  });
});

// Save workspace label catalog (insert new labels + update existing labels)
router.post("/label-catalog", async (req, res) => {
  const supabase = getSupabaseClient();
  const user_id = req.user.id;
  const { labels } = req.body;

  //chat gpt generated
  const rows = labels
    .filter((label) => label.name?.trim())
    .map((label) => ({
      ...(label.id && /^[0-9a-fA-F-]{36}$/.test(label.id)
        ? { id: label.id }
        : {}),
      name: label.name.trim(),
      color: label.color,
      is_custom: Boolean(label.custom),
      created_by: user_id,
    }));

  if (rows.length === 0) {
    return res.status(400).json({
      error: "No valid labels provided.",
    });
  }

  const { data, error } = await supabase
    .from("workspace_label_catalog")
    .upsert(rows, {
      onConflict: "id",
    })
    .select();

  if (error) {
    console.error("Unable to save label catalog:", error);
    return res.status(500).json({
      error: error.message,
    });
  }

  return res.status(200).json(
    data.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      custom: label.is_custom,
    }))
  );
});

// Get workspace label catalog
router.get("/label-catalog", async (req, res) => {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("workspace_label_catalog")
    .select("*")
    .order("name");

  if (error) {
    return res.status(500).json({
      error: "Unable to get workspace label catalog.",
    });
  }

  const labels = data.map((label) => ({
    id: label.id,
    name: label.name,
    color: label.color,
    custom: label.is_custom,
  }));

  return res.status(200).json(labels);
});
