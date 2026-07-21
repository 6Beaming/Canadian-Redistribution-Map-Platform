import { Router } from "express";
import {
  getSupabaseAdminDataClient,
  getSupabaseProfileEmailsAsAdmin,
} from "../lib/supabase.js";
import { requirePublicUser } from "../middleware/requireAuth.js";
import {
  CounterProposalValidationError,
  MapAssetValidationError,
  prepareCounterProposalSubmission,
} from "../lib/map/counterProposalSubmission.js";

const router = Router();

function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    res.status(403).json({ error: "Commissioner access is required." });
    return;
  }

  next();
}

function normalizeCounterProposalRecord(submission, revision, profile = null) {
  return {
    ...submission,
    type: "counter_proposal",
    revision: revision ?? null,
    profile: profile ?? submission.profile ?? null,
    authorEmail: profile?.email ?? submission.authorEmail ?? null,
  };
}

async function attachAuthorProfiles(records) {
  const userIds = [...new Set(records.map((record) => record.user_id).filter(Boolean))];
  let profiles = [];

  try {
    profiles = await getSupabaseProfileEmailsAsAdmin(userIds);
  } catch (profileError) {
    console.error("Unable to resolve counter-proposal author emails:", profileError);
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return records.map((record) =>
    normalizeCounterProposalRecord(
      record,
      record.revision,
      profileById.get(record.user_id) ?? null,
    ),
  );
}

router.post("/counter-proposals", requirePublicUser, async (req, res, next) => {
  try {
    const prepared = await prepareCounterProposalSubmission(req.body);
    const supabase = getSupabaseAdminDataClient();
    const now = new Date().toISOString();

    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .insert([{
        ...prepared.submission,
        user_id: req.user.id,
        created_at: now,
        updated_at: now,
      }])
      .select("*")
      .single();

    if (submissionError) {
      return res.status(500).json({ error: submissionError.message });
    }

    const { data: revision, error: revisionError } = await supabase
      .from("counter_proposal_revisions")
      .insert([{
        ...prepared.revision,
        submission_id: submission.id,
        created_by: req.user.id,
      }])
      .select("*")
      .single();

    if (revisionError) {
      await supabase.from("submissions").delete().eq("id", submission.id);
      return res.status(500).json({ error: revisionError.message });
    }

    return res.status(201).json(
      (await attachAuthorProfiles([
        normalizeCounterProposalRecord(submission, revision),
      ]))[0],
    );
  } catch (error) {
    if (
      error instanceof CounterProposalValidationError
      || error instanceof MapAssetValidationError
    ) {
      return res.status(error.statusCode || 400).json({
        error: error.publicMessage || error.message,
        validation_report: error.validationReport ?? null,
      });
    }

    return next(error);
  }
});

router.get("/counter-proposals", requireCommissioner, async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { data: submissions, error } = await supabase
    .from("submissions")
    .select("*")
    .eq("type", "counter_proposal")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const submissionIds = (submissions ?? []).map((submission) => submission.id);

  if (!submissionIds.length) {
    return res.json([]);
  }

  const { data: revisions, error: revisionError } = await supabase
    .from("counter_proposal_revisions")
    .select("*")
    .in("submission_id", submissionIds)
    .order("revision_number", { ascending: false });

  if (revisionError) {
    return res.status(500).json({ error: revisionError.message });
  }

  const latestRevisionBySubmissionId = new Map();

  (revisions ?? []).forEach((revision) => {
    if (!latestRevisionBySubmissionId.has(revision.submission_id)) {
      latestRevisionBySubmissionId.set(revision.submission_id, revision);
    }
  });

  return res.json(
    await attachAuthorProfiles(
      (submissions ?? []).map((submission) =>
        normalizeCounterProposalRecord(
          submission,
          latestRevisionBySubmissionId.get(submission.id) ?? null,
        ),
      ),
    ),
  );
});

router.get("/counter-proposals/:submissionId", async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { submissionId } = req.params;
  const isCommissioner = req.profile?.role === "commissioner";

  const { data: submission, error } = await supabase
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .eq("type", "counter_proposal")
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!submission) {
    return res.status(404).json({ error: "Counter-proposal not found." });
  }

  if (!isCommissioner && submission.user_id !== req.user.id) {
    return res.status(403).json({ error: "You can only view your own counter-proposals." });
  }

  const { data: revision, error: revisionError } = await supabase
    .from("counter_proposal_revisions")
    .select("*")
    .eq("submission_id", submissionId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (revisionError) {
    return res.status(500).json({ error: revisionError.message });
  }

  const [record] = await attachAuthorProfiles([
    normalizeCounterProposalRecord(submission, revision),
  ]);
  return res.json(record);
});

export default router;
