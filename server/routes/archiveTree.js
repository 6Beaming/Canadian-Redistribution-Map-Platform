import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import {
  getArchiveBranch,
  getArchiveBranchView,
  getArchiveVersion,
  listArchiveProjectionsForDguid,
  listArchiveTreeRecords,
} from "../lib/archive/archiveRepository.js";
import { getArchivedMapSnapshot } from "../lib/archive/archivedMapRepository.js";
import {
  mergeApprovedArchiveRequest,
  reinitializeArchiveBranch,
  revertArchiveVersion,
} from "../lib/archive/archiveMergeService.js";

const router = Router();

function handleArchiveError(res, error, fallbackMessage) {
  return res.status(error.statusCode || 500).json({
    error: error.message || fallbackMessage,
    ...(error.code ? { code: error.code } : {}),
  });
}

router.get("/archive-tree", async (_req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const payload = await listArchiveTreeRecords(supabase);
    return res.json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to load the Archived Tree.");
  }
});

router.get("/archive-tree/branches/:branchId", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const payload = await getArchiveBranch(supabase, req.params.branchId);
    return res.json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to load the archive branch.");
  }
});

router.get("/archive-tree/versions/:versionId/view", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const payload = await getArchiveBranchView(supabase, {
      selectedVersionId: req.params.versionId,
      branchKey: req.query.branchKey ?? null,
      includeLatestGeometry: req.query.includeDifference !== "0",
    });
    return res.json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to load the archived branch view.");
  }
});

router.get("/archive-tree/versions/:versionId", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const payload = await getArchiveVersion(supabase, req.params.versionId, {
      includeGeometry: false,
    });
    return res.json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to load the archive version.");
  }
});

router.get("/archive-tree/versions/:versionId/geometry", async (req, res) => {
  try {
    const representation = String(req.query.representation ?? "display").toLowerCase();
    if (representation !== "display") {
      return res.status(400).json({ error: "Only display geometry is available to browser clients." });
    }
    const supabase = getSupabaseAdminDataClient();
    const payload = await getArchiveVersion(supabase, req.params.versionId, {
      includeGeometry: true,
    });
    return res.json({
      versionId: payload.versionId,
      representation: "display",
      displayGeometry: payload.displayGeometry ?? null,
      geometryDigest: payload.geometryDigest ?? null,
    });
  } catch (error) {
    return handleArchiveError(res, error, "Unable to load archive version geometry.");
  }
});

router.get("/archive-map", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const payload = await getArchivedMapSnapshot(supabase, {
      dguids: req.query.dguids,
      expectedRevision: req.query.expectedRevision,
      includeAllHeads: req.query.includeAllHeads === "1" || !req.query.dguids,
    });
    return res.json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to load the archived map.");
  }
});

router.get("/archive-map/projections", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const payload = await listArchiveProjectionsForDguid(supabase, req.query.dguid);
    return res.json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to load archived map projections.");
  }
});

router.post("/archive/merge", async (req, res) => {
  try {
    const archiveRequestId = String(req.body?.archiveRequestId ?? "").trim();
    if (!archiveRequestId) {
      return res.status(400).json({ error: "archiveRequestId is required." });
    }
    const supabase = getSupabaseAdminDataClient();
    const payload = await mergeApprovedArchiveRequest(supabase, {
      archiveRequestId,
      closingComment: req.body?.closingComment ?? null,
      actorUser: req.user,
      actorProfile: req.profile,
    });
    return res.status(201).json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to merge into the archive.");
  }
});

router.post("/archive/versions/:versionId/revert", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const payload = await revertArchiveVersion(supabase, {
      versionId: req.params.versionId,
      actorUser: req.user,
      actorProfile: req.profile,
      expectedBranchVersion: Number(req.body?.expectedBranchVersion),
      expectedMapRevision: req.body?.expectedMapRevision ?? null,
    });
    return res.json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to revert the archive version.");
  }
});

router.delete("/archive/branches/:branchId", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const payload = await reinitializeArchiveBranch(supabase, {
      branchId: req.params.branchId,
      actorUser: req.user,
      actorProfile: req.profile,
      expectedBranchVersion: Number(req.body?.expectedBranchVersion),
    });
    return res.json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to reinitialize the archive branch.");
  }
});

export default router;
