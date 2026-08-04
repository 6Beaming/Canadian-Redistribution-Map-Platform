import { Router } from "express";
import {
  cancelArchiveRequest,
  castArchiveRequestVote,
  createArchiveRequest,
  getArchiveRequestForSubmission,
  updateArchiveRequestAssignees,
} from "../lib/archiveRequests/service.js";

const router = Router();

function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    return res.status(403).json({ error: "Commissioner access is required." });
  }
  return next();
}

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.message || "Archive Request request failed.",
    ...(error.code ? { code: error.code } : {}),
    ...(error.currentClaimPruid ? { currentClaimPruid: error.currentClaimPruid } : {}),
  });
}

router.use(requireCommissioner);

router.get("/archive-requests/:submissionId", async (req, res) => {
  try {
    const readModel = await getArchiveRequestForSubmission({
      submissionId: req.params.submissionId,
      actorProfile: req.profile,
    });
    return res.json(readModel);
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/archive-requests", async (req, res) => {
  try {
    const submissionId = String(req.body?.submissionId ?? "").trim();
    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required." });
    }
    const readModel = await createArchiveRequest({
      submissionId,
      assigneeEmails: req.body?.assignees ?? [],
      expectedVersion: req.body?.expectedVersion,
      actorUser: req.user,
      actorProfile: req.profile,
    });
    return res.status(201).json(readModel);
  } catch (error) {
    return sendError(res, error);
  }
});

// Compatibility with the Demo-3 client path while CP4 clients migrate.
router.post("/archive-requests/:submissionId", async (req, res) => {
  try {
    const readModel = await createArchiveRequest({
      submissionId: req.params.submissionId,
      assigneeEmails: req.body?.assignees ?? [],
      expectedVersion: req.body?.expectedVersion,
      actorUser: req.user,
      actorProfile: req.profile,
    });
    return res.status(201).json(readModel);
  } catch (error) {
    return sendError(res, error);
  }
});

router.patch("/archive-requests/:requestId/assignees", async (req, res) => {
  try {
    const readModel = await updateArchiveRequestAssignees({
      requestId: req.params.requestId,
      assigneeEmails: req.body?.assignees ?? [],
      expectedVersion: req.body?.expectedVersion,
      actorUser: req.user,
      actorProfile: req.profile,
    });
    return res.json(readModel);
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/archive-requests/:requestId/votes", async (req, res) => {
  try {
    const readModel = await castArchiveRequestVote({
      requestId: req.params.requestId,
      vote: req.body?.vote,
      expectedVersion: req.body?.expectedVersion,
      actorUser: req.user,
      actorProfile: req.profile,
    });
    return res.json(readModel);
  } catch (error) {
    return sendError(res, error);
  }
});

router.delete("/archive-requests/:requestId", async (req, res) => {
  try {
    const readModel = await cancelArchiveRequest({
      requestId: req.params.requestId,
      expectedVersion: req.body?.expectedVersion ?? req.query?.expectedVersion,
      actorUser: req.user,
      actorProfile: req.profile,
    });
    return res.json(readModel);
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
