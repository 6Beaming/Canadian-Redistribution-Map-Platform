import { Router } from "express";
import {
  getSupabaseAdminDataClient,
  getSupabaseProfileEmailsAsAdmin,
} from "../lib/supabase.js";
import { requirePublicUser } from "../middleware/requireAuth.js";
import {
  CounterProposalValidationError,
  MapAssetValidationError,
  prepareCounterProposalSubmissionV2,
} from "../lib/map/counterProposalSubmission.js";
import {
  createCounterProposalSubmissionV2,
  materializeGeometryOperations,
} from "../lib/map/geometryOperations.js";
import {
  geometryRevisionToApiRevision,
  loadLatestCounterProposalGeometryRevision,
  loadLatestCounterProposalGeometryRevisions,
} from "../lib/map/counterProposalRevisionStore.js";
import { assertActiveMapRelease } from "../lib/map/mapReleaseGate.js";
import { withServerTimingSpan } from "../lib/serverTiming.js";

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
    if (String(req.body?.schemaVersion ?? "").trim() !== "2.0") {
      return res.status(400).json({
        error: "Counter-Proposal submissions require schemaVersion 2.0.",
        code: "COUNTER_PROPOSAL_V2_REQUIRED",
      });
    }

    const activeRelease = await withServerTimingSpan(req, "asset-read", () => assertActiveMapRelease());
    const prepared = await withServerTimingSpan(
      req,
      "materialize",
      () => prepareCounterProposalSubmissionV2(req.body, activeRelease),
    );
    const supabase = getSupabaseAdminDataClient();
    const persisted = await createCounterProposalSubmissionV2(supabase, {
      userId: req.user.id,
      title: prepared.submission.title,
      comment: prepared.submission.comment,
      releaseId: prepared.compact.releaseId,
      baseRevision: prepared.compact.baseRevision,
      primaryDguid: prepared.compact.primaryDguid,
      secondaryDguid: prepared.compact.secondaryDguid,
      fedNum: prepared.submission.fed_num,
      geometryDigest: prepared.compact.geometryDigest,
      validationReport: prepared.validationReport,
      operations: prepared.compact.operations,
      scopePruids: prepared.scopePruids,
    });

    return res.status(201).json({
      schemaVersion: "2.0",
      submission: {
        id: persisted.submission.id,
        type: "counter-proposal",
        title: persisted.submission.title,
        status: persisted.submission.status,
        created_at: persisted.submission.created_at,
        resource_version: persisted.submission.resource_version,
        dguid: persisted.submission.dguid,
        neighboring_dguid: persisted.submission.neighboring_dguid,
        release_id: persisted.submission.release_id,
      },
      geometryRevision: {
        id: persisted.geometry_revision.id,
        revisionNumber: persisted.geometry_revision.revision_number,
        operationCount: prepared.compact.operations.length,
        geometryDigest: persisted.geometry_revision.geometry_digest,
      },
      impactSummary: prepared.validationReport.impact_summary ?? {},
    });
  } catch (error) {
    if (
      error instanceof CounterProposalValidationError ||
      error instanceof MapAssetValidationError
    ) {
      return res.status(error.statusCode || 400).json({
        error: error.publicMessage || error.message,
        code: error.code ?? null,
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

  const revisionsBySubmissionId = await loadLatestCounterProposalGeometryRevisions(supabase, submissionIds);

  return res.json(
    await attachAuthorProfiles(
      (submissions ?? []).map((submission) =>
        normalizeCounterProposalRecord(
          submission,
          geometryRevisionToApiRevision(revisionsBySubmissionId.get(submission.id) ?? null),
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

  const geometryRevision = await loadLatestCounterProposalGeometryRevision(supabase, submissionId);

  if (!geometryRevision || geometryRevision.migration_state !== "ready") {
    return res.status(409).json({
      code: "SUBMISSION_GEOMETRY_NOT_READY",
      error: "Counter-Proposal geometry revision is not ready.",
    });
  }

  const [record] = await attachAuthorProfiles([
    normalizeCounterProposalRecord(
      submission,
      geometryRevisionToApiRevision(geometryRevision),
    ),
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
