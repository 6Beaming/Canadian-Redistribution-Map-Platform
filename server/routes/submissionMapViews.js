import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import { requirePublicUser } from "../middleware/requireAuth.js";
import { normalizeSubmissionType } from "../lib/map/submissionPresentation.js";

const router = Router();

const MAP_VIEW_SUBMISSION_COLUMNS = [
  "id",
  "user_id",
  "type",
  "title",
  "comment",
  "status",
  "created_at",
  "updated_at",
  "dguid",
  "neighboring_dguid",
].join(",");

const MAP_VIEW_REVISION_COLUMNS = [
  "id",
  "primary_dguid",
  "secondary_dguid",
  "baseline_revision",
  "validation_report",
].join(",");

function normalizeOperations(validationReport) {
  const operations = validationReport?.operations;
  return Array.isArray(operations) ? operations : [];
}

function serializeMapView(submission, revision, user) {
  const type = normalizeSubmissionType(submission.type);
  const baseRevision = revision?.baseline_revision ?? null;

  return {
    submission: {
      id: submission.id,
      type,
      title: submission.title ?? "",
      comment: submission.comment ?? "",
      author: {
        id: user.id,
        email: user.email ?? null,
      },
      status: submission.status,
      createdAt: submission.created_at,
      updatedAt: submission.updated_at,
    },
    map: {
      // Until the immutable release migration lands, a persisted CP baseline
      // is the only authoritative release descriptor available on this branch.
      releaseId: baseRevision,
      baseRevision,
      primaryDguid: revision?.primary_dguid ?? submission.dguid ?? null,
      secondaryDguid:
        revision?.secondary_dguid ?? submission.neighboring_dguid ?? null,
      geometryRevisionId: revision?.id ?? null,
      operations: normalizeOperations(revision?.validation_report),
      impactSummary: revision?.validation_report?.impact_summary ?? null,
    },
  };
}

// This endpoint intentionally has a page-specific DTO. It never returns
// geometry snapshots or Commissioner Workspace collaboration state.
router.get("/:submissionId/map-view", requirePublicUser, async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const { data: submission, error } = await supabase
      .from("submissions")
      .select(MAP_VIEW_SUBMISSION_COLUMNS)
      .eq("id", req.params.submissionId)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Deliberately collapse missing and non-owned resources to the same 404.
    if (!submission) {
      return res.status(404).json({ error: "Submission not found." });
    }

    let revision = null;
    if (normalizeSubmissionType(submission.type) === "counter-proposal") {
      const { data, error: revisionError } = await supabase
        .from("counter_proposal_revisions")
        .select(MAP_VIEW_REVISION_COLUMNS)
        .eq("submission_id", submission.id)
        .order("revision_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (revisionError) {
        return res.status(500).json({ error: revisionError.message });
      }

      revision = data ?? null;
    }

    return res.json(serializeMapView(submission, revision, req.user));
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unable to load submission map view.",
    });
  }
});

export default router;
export {
  MAP_VIEW_REVISION_COLUMNS,
  MAP_VIEW_SUBMISSION_COLUMNS,
  serializeMapView,
};
