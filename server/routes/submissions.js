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
import {
  deriveCounterProposalOperations,
  persistSubmissionGeometryRevision,
  materializeGeometryOperations,
} from "../lib/map/geometryOperations.js";
import { assertActiveMapRelease } from "../lib/map/mapReleaseGate.js";

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
    await assertActiveMapRelease();
    const prepared = await prepareCounterProposalSubmission(req.body);
    const compactGeometry = await deriveCounterProposalOperations({
      primaryDguid: prepared.revision.primary_dguid,
      secondaryDguid: prepared.revision.secondary_dguid,
      originalGeometry: prepared.revision.original_geometry,
      proposedGeometry: prepared.revision.proposed_geometry,
    });
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

      return res.status(500).json({
        error: revisionError.message,
      });
    }

    let geometryRevision;
    try {
      geometryRevision = await persistSubmissionGeometryRevision(supabase, {
        submission,
        submissionType: "counter_proposal",
        compact: compactGeometry,
        validationReport: prepared.revision.validation_report,
        legacyRevisionId: revision.id,
      });
    } catch (geometryRevisionError) {
      await supabase.from("submissions").delete().eq("id", submission.id);
      return res.status(500).json({ error: geometryRevisionError.message });
    }

    const response = (await attachAuthorProfiles([
      normalizeCounterProposalRecord(submission, revision),
    ]))[0];
    return res.status(201).json({ ...response, geometry_revision: geometryRevision });

  } catch (error) {
    if (
      error instanceof CounterProposalValidationError ||
      error instanceof MapAssetValidationError
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

router.get("/:submissionId/geometry", async (req, res, next) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const isCommissioner = req.profile?.role === "commissioner";
    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .select("id,user_id,type,release_id,dguid,neighboring_dguid,status")
      .eq("id", req.params.submissionId)
      .maybeSingle();
    if (submissionError) throw submissionError;
    if (!submission) {
      res.status(404).json({ error: "Submission geometry was not found." });
      return;
    }
    if (!isCommissioner && submission.user_id !== req.user.id) {
      res.status(403).json({ error: "You can only view your own submission geometry." });
      return;
    }
    const { data: descriptor, error: descriptorError } = await supabase
      .from("submission_geometry_revisions")
      .select("id,submission_id,submission_type,revision_number,release_id,base_revision,primary_dguid,secondary_dguid,geometry_digest,validation_report,migration_state,created_at")
      .eq("submission_id", submission.id)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (descriptorError) throw descriptorError;
    if (!descriptor || descriptor.migration_state !== "ready") {
      res.status(409).json({
        code: "SUBMISSION_GEOMETRY_NOT_READY",
        error: "Submission geometry migration is not ready.",
      });
      return;
    }
    const { data: operations, error: operationError } = await supabase
      .from("submission_geometry_operations")
      .select("operation_index,vertex_id,operation_type,base_lng,base_lat,to_lng,to_lat")
      .eq("revision_id", descriptor.id)
      .order("operation_index", { ascending: true });
    if (operationError) throw operationError;
    const response = {
      submissionId: submission.id,
      type: descriptor.submission_type,
      releaseId: descriptor.release_id,
      baseRevision: descriptor.base_revision,
      primaryDguid: descriptor.primary_dguid,
      secondaryDguid: descriptor.secondary_dguid,
      geometryDigest: descriptor.geometry_digest,
      impactSummary: descriptor.validation_report?.impact_summary ?? null,
      operations: operations ?? [],
    };
    if (req.query.materialize === "1") {
      response.geometry = await materializeGeometryOperations(descriptor, operations ?? []);
    }
    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
