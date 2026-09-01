import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import {
  getArchiveBranch,
  getArchiveVersion,
  listArchiveTreeRecords,
} from "../lib/archive/archiveRepository.js";
import { getArchivedMapSnapshot } from "../lib/archive/archivedMapRepository.js";

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
    });
    return res.json(payload);
  } catch (error) {
    return handleArchiveError(res, error, "Unable to load the archived map.");
  }
});

export default router;
