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
  "release_id",
].join(",");

const MAP_VIEW_REVISION_COLUMNS = [
  "id",
  "primary_dguid",
  "secondary_dguid",
  "release_id",
  "base_revision",
  "geometry_digest",
  "validation_report",
  "migration_state",
].join(",");

function serializeMapView(submission, revision, operations, user) {
  const type = normalizeSubmissionType(submission.type);
  const baseRevision = revision?.base_revision ?? null;

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
      releaseId: revision?.release_id ?? submission.release_id ?? null,
      baseRevision,
      primaryDguid: revision?.primary_dguid ?? submission.dguid ?? null,
      secondaryDguid:
        revision?.secondary_dguid ?? submission.neighboring_dguid ?? null,
      geometryRevisionId: revision?.id ?? null,
      geometryDigest: revision?.geometry_digest ?? null,
      operations: (operations ?? []).map((operation) => ({
        operation_index: operation.operation_index,
        vertex_id: operation.vertex_id,
        operation_type: operation.operation_type,
        base_lng: operation.base_lng,
        base_lat: operation.base_lat,
        to_lng: operation.to_lng,
        to_lat: operation.to_lat,
      })),
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
    let operations = [];
    if (["objection", "counter-proposal"].includes(normalizeSubmissionType(submission.type))) {
      const { data, error: revisionError } = await supabase
        .from("submission_geometry_revisions")
        .select(MAP_VIEW_REVISION_COLUMNS)
        .eq("submission_id", submission.id)
        .order("revision_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (revisionError) {
        return res.status(500).json({ error: revisionError.message });
      }

      revision = data ?? null;
      if (!revision || revision.migration_state !== "ready") {
        return res.status(409).json({
          code: "SUBMISSION_GEOMETRY_NOT_READY",
          error: "Submission geometry migration is not ready.",
        });
      }

      const { data: operationRows, error: operationError } = await supabase
        .from("submission_geometry_operations")
        .select("operation_index,vertex_id,operation_type,base_lng,base_lat,to_lng,to_lat")
        .eq("revision_id", revision.id)
        .order("operation_index", { ascending: true });
      if (operationError) {
        return res.status(500).json({ error: operationError.message });
      }
      operations = operationRows ?? [];
    }

    if (!revision && !submission.release_id) {
      return res.status(409).json({
        code: "SUBMISSION_RELEASE_NOT_READY",
        error: "Submission map release migration is not ready.",
      });
    }

    return res.json(serializeMapView(submission, revision, operations, req.user));
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
