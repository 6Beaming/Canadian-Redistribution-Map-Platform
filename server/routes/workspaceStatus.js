import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import {
  authorizeSubmissionScope,
  notFoundScopeError,
} from "../lib/authorization/resourceScopeGuard.js";

const router = Router();

const DURABLE_STATUS_VALUES = new Set(["accepted", "rejected"]);
const ARCHIVE_OWNED_STATUS_VALUES = new Set([
  "archive-request",
  "archived",
]);

const STATUS_SELECT = [
  "id",
  "status",
  "resource_version",
  "updated_at",
  "dguid",
  "neighboring_dguid",
  "active_claim_pruid",
  "active_claim_kind",
].join(",");

function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    res.status(403).json({ error: "Commissioner access is required." });
    return;
  }

  next();
}

function serializeStatus(row, scope = null) {
  return {
    submissionId: row.id,
    status: row.status,
    version: Number(row.resource_version) || 1,
    updatedAt: row.updated_at ?? null,
    eligibilityPruids: scope?.eligibilityPruids ?? [],
    operatingPruid: scope?.operatingPruid ?? null,
    crossProvinceWarning: scope?.crossProvinceWarning ?? null,
  };
}

function parseExpectedVersion(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const version = Number(value);
  if (!Number.isInteger(version) || version <= 0) {
    const error = new Error("expectedVersion must be a positive integer.");
    error.statusCode = 400;
    error.code = "INVALID_EXPECTED_VERSION";
    throw error;
  }

  return version;
}

function sendScopeError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.message,
    code: error.code,
    ...(error.currentClaimPruid
      ? { currentClaimPruid: error.currentClaimPruid }
      : {}),
    ...(error.current ? { current: error.current } : {}),
  });
}

router.use(requireCommissioner);

router.get("/submissions/:submissionId/status", async (req, res) => {
  const submissionId = String(req.params.submissionId ?? "").trim();
  if (!submissionId) {
    return res.status(400).json({ error: "submissionId is required." });
  }

  const supabase = getSupabaseAdminDataClient();
  const { data, error } = await supabase
    .from("submissions")
    .select(STATUS_SELECT)
    .eq("id", submissionId)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    return res.status(404).json({ error: "Submission not found." });
  }

  try {
    const scope = await authorizeSubmissionScope(supabase, {
      submission: data,
      commissionerProfile: req.profile,
      requireClaim: false,
    });
    return res.json(serializeStatus(data, scope));
  } catch (scopeError) {
    return sendScopeError(res, scopeError);
  }
});

router.patch("/submissions/:submissionId/status", async (req, res) => {
  const submissionId = String(req.params.submissionId ?? "").trim();
  const status = String(req.body?.status ?? "").trim().toLowerCase();

  if (!submissionId) {
    return res.status(400).json({ error: "submissionId is required." });
  }

  if (ARCHIVE_OWNED_STATUS_VALUES.has(status) || status === "archive_request") {
    return res.status(400).json({
      error:
        "Archive-owned statuses cannot be written through the Workspace status route.",
      code: "ARCHIVE_OWNED_STATUS",
    });
  }

  if (!DURABLE_STATUS_VALUES.has(status)) {
    return res.status(400).json({
      error: "Only accepted and rejected are supported on this route.",
      code: "UNSUPPORTED_STATUS",
    });
  }

  let expectedVersion;
  try {
    expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      error: error.message,
      code: error.code,
    });
  }

  const supabase = getSupabaseAdminDataClient();
  const { data: current, error: currentError } = await supabase
    .from("submissions")
    .select(STATUS_SELECT)
    .eq("id", submissionId)
    .maybeSingle();

  if (currentError) {
    return res.status(500).json({ error: currentError.message });
  }

  if (!current) {
    return res.status(404).json({ error: "Submission not found." });
  }

  let scope;
  try {
    scope = await authorizeSubmissionScope(supabase, {
      submission: current,
      commissionerProfile: req.profile,
      requireClaim: true,
    });
  } catch (scopeError) {
    if (scopeError.code === "RESOURCE_ALREADY_CLAIMED") {
      return res.status(409).json({
        error: scopeError.message,
        code: scopeError.code,
        currentClaimPruid: scopeError.currentClaimPruid,
        current: serializeStatus(current, {
          eligibilityPruids: [],
          operatingPruid: null,
          crossProvinceWarning: null,
        }),
      });
    }
    return sendScopeError(res, scopeError);
  }

  const currentVersion = Number(current.resource_version) || 1;

  if (expectedVersion !== null && expectedVersion !== currentVersion) {
    return res.status(409).json({
      error: "The submission status was updated by another Commissioner.",
      code: "STALE_RESOURCE_VERSION",
      current: serializeStatus(current, scope),
    });
  }

  if (
    String(current.status).toLowerCase() === status
    && (expectedVersion === null || expectedVersion === currentVersion)
  ) {
    return res.json(serializeStatus(current, scope));
  }

  const { data, error } = await supabase
    .from("submissions")
    .update({
      status,
      resource_version: currentVersion + 1,
      updated_at: new Date().toISOString(),
      active_claim_pruid: null,
      active_claim_kind: null,
      active_claim_actor_id: null,
      active_claim_at: null,
    })
    .eq("id", submissionId)
    .eq("resource_version", currentVersion)
    .or(`active_claim_pruid.is.null,active_claim_pruid.eq.${scope.operatingPruid}`)
    .select(STATUS_SELECT)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    const { data: latest } = await supabase
      .from("submissions")
      .select(STATUS_SELECT)
      .eq("id", submissionId)
      .maybeSingle();

    if (!latest) {
      return sendScopeError(res, notFoundScopeError());
    }

    const claim = String(latest.active_claim_pruid ?? "").trim();
    if (claim && claim !== scope.operatingPruid) {
      return res.status(409).json({
        error: "Another province has already claimed this resource for an active operation.",
        code: "RESOURCE_ALREADY_CLAIMED",
        currentClaimPruid: claim,
        current: serializeStatus(latest, scope),
      });
    }

    return res.status(409).json({
      error: "The submission status was updated by another Commissioner.",
      code: "STALE_RESOURCE_VERSION",
      current: serializeStatus(latest, scope),
    });
  }

  return res.json(serializeStatus(data, scope));
});

export default router;
