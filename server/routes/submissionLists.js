import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import {
  getCommissionerSubmissionRowV2,
  listCommissionerSubmissionRowsV2,
  listMySubmissionRowsV2,
} from "../lib/submissions/submissionListRepository.js";
import { getCommissionerSubmissionAnalytics } from "../lib/submissions/submissionAnalyticsQuery.js";
import { withServerTimingSpan } from "../lib/serverTiming.js";

const router = Router();

function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    return res.status(403).json({ error: "Commissioner access is required." });
  }
  return next();
}

function requirePublicUser(req, res, next) {
  if (req.profile?.role !== "public_user") {
    return res.status(403).json({ error: "Public user access is required." });
  }
  return next();
}

async function listRows(req, res, {
  ownerId = null,
  includeProfiles = false,
  scopeToCommissioner = false,
} = {}) {
  try {
    const supabase = getSupabaseAdminDataClient();
    if (ownerId) {
      const payload = await withServerTimingSpan(req, "db", () => listMySubmissionRowsV2(supabase, {
        userId: ownerId,
        query: req.query,
      }));
      return res.json(payload);
    }
    if (scopeToCommissioner) {
      const payload = await withServerTimingSpan(req, "db", () => listCommissionerSubmissionRowsV2(supabase, {
        actorProfile: req.profile,
        query: req.query,
      }));
      return res.json(payload);
    }
    return res.status(503).json({
      error: "Submission list contract is unavailable for this route.",
      code: "SUBMISSION_LIST_CONTRACT_MISSING",
    });
  } catch (error) {
    if (error?.code === "42883" || /function .* does not exist/i.test(String(error?.message ?? ""))) {
      return res.status(503).json({
        error: "Submission list RPC is missing after protocol cleanup.",
        code: "SUBMISSION_LIST_CONTRACT_MISSING",
      });
    }
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to load submissions.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

router.get("/mine", requirePublicUser, (req, res) =>
  listRows(req, res, { ownerId: req.user.id, includeProfiles: false }));

router.get("/table-row/:submissionId", requireCommissioner, async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    try {
      const item = await getCommissionerSubmissionRowV2(supabase, {
        submissionId: req.params.submissionId,
        actorProfile: req.profile,
      });
      if (!item) {
        return res.status(404).json({ error: "Submission not found." });
      }
      return res.json({ item });
    } catch (rpcError) {
      if (rpcError?.code !== "42883" && !/function .* does not exist/i.test(String(rpcError?.message ?? ""))) {
        throw rpcError;
      }
      return res.status(503).json({
        error: "Submission table-row RPC is missing after protocol cleanup.",
        code: "SUBMISSION_LIST_CONTRACT_MISSING",
      });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load submission." });
  }
});

router.get("/analytics", requireCommissioner, async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    const payload = await withServerTimingSpan(req, "db", () => getCommissionerSubmissionAnalytics(supabase, {
      actorProfile: req.profile,
      query: req.query,
    }));
    return res.json(payload);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to load submission analytics.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
});

router.get("/", requireCommissioner, (req, res) =>
  listRows(req, res, { includeProfiles: true, scopeToCommissioner: true }));

export default router;
