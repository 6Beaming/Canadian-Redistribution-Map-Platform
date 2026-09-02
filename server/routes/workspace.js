import { Router } from "express";
import {
  getSupabaseAdminDataClient,
} from "../lib/supabase.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { resolveCommissionerFedContext } from "../lib/authorization/commissionerAreaContext.js";
import { queryDashboardAreaSubmissions } from "../lib/submissions/dashboardAreaQuery.js";
import archiveTreeRouter from "./archiveTree.js";
import { listArchiveTreeRecords } from "../lib/archive/archiveRepository.js";
import { mergeApprovedArchiveRequest } from "../lib/archive/archiveMergeService.js";
import { resolveMergeableArchiveRequest } from "../lib/archiveRequests/service.js";

const router = Router();
function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    res.status(403).json({ error: "Commissioner access is required." });
    return;
  }

  next();
}

router.use(requireAuth, requireCommissioner);

router.get("/dashboard/areas/:dguid", async (req, res) => {
  try {
    const result = await queryDashboardAreaSubmissions(getSupabaseAdminDataClient(), {
      dguid: req.params.dguid,
      commissionerProfile: req.profile,
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to load Dashboard submissions.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
});

router.get("/dashboard/feds/:fedNum/scope-context", async (req, res) => {
  try {
    const scope = resolveCommissionerFedContext(req.params.fedNum, req.profile);
    return res.json(scope);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to resolve FED scope context.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
});

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
  try {
    const supabase = getSupabaseAdminDataClient();
    const { records } = await listArchiveTreeRecords(supabase);
    return res.json(records);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to load archive records.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
});

// Atomic Supabase merge: snapshot, version ordering, Latest state, Workspace
// cleanup, and submission status change happen in one PostgreSQL transaction.
router.post("/archive", async (req, res) => {
  const submissionId = String(req.body?.submissionId ?? "").trim();
  if (!submissionId) {
    return res.status(400).json({ error: "submissionId is required." });
  }

  const supabase = getSupabaseAdminDataClient();
  const approvedRequest = await resolveMergeableArchiveRequest(supabase, submissionId);

  if (approvedRequest?.id) {
    try {
      const payload = await mergeApprovedArchiveRequest(supabase, {
        archiveRequestId: approvedRequest.id,
        closingComment: req.body?.closingComment ?? null,
        actorUser: req.user,
        actorProfile: req.profile,
      });
      return res.status(201).json(payload);
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Unable to merge into the archive.",
        ...(error.code ? { code: error.code } : {}),
      });
    }
  }

  return res.status(409).json({
    error: "An approved Archive Request with a sealed source revision is required.",
    code: "ARCHIVE_REQUEST_NOT_APPROVED",
  });
});

// Fail closed for pre-v2 clients; v2 reverts require an immutable version ID.
router.patch("/archive/branch/latest", async (req, res) => {
  return res.status(410).json({
    error: "The legacy branch revert route has been retired. Use an archive v2 version ID.",
    code: "ARCHIVE_V2_REQUIRED",
  });
});

// Fail closed for pre-v2 clients; v2 reinitialization requires a branch UUID.
router.delete("/archive/branch", async (req, res) => {
  return res.status(410).json({
    error: "The legacy branch delete route has been retired. Use an archive v2 branch ID.",
    code: "ARCHIVE_V2_REQUIRED",
  });
});

router.use(archiveTreeRouter);

export default router;
