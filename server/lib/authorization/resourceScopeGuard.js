import { getProfileForDguid as defaultGetProfileForDguid } from "../map/mapAssetAuthority.js";
import {
  formatCrossProvinceWarning,
  normalizePruid,
  resolveCommissionerPruid,
} from "./provinceCatalog.js";

let getProfileForDguidImpl = defaultGetProfileForDguid;

export function setResourceScopeTestDoubles(doubles = null) {
  getProfileForDguidImpl = doubles?.getProfileForDguid ?? defaultGetProfileForDguid;
}

function scopeError(message, { statusCode, code } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function notFoundScopeError() {
  return scopeError("Submission not found.", {
    statusCode: 404,
    code: "NOT_FOUND",
  });
}

export function missingCommissionerProvinceError() {
  return scopeError("Commissioner province registration is required.", {
    statusCode: 403,
    code: "MISSING_COMMISSIONER_PROVINCE",
  });
}

export function resourceAlreadyClaimedError(currentClaimPruid) {
  const error = scopeError(
    "Another province has already claimed this resource for an active operation.",
    {
      statusCode: 409,
      code: "RESOURCE_ALREADY_CLAIMED",
    },
  );
  error.currentClaimPruid = currentClaimPruid ?? null;
  return error;
}

export async function deriveEligibilityPruids(primaryDguid, secondaryDguid) {
  const dguids = [primaryDguid, secondaryDguid]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  const pruids = [];
  for (const dguid of dguids) {
    const profile = await getProfileForDguidImpl(dguid);
    const pruid = normalizePruid(profile?.pruid);
    if (pruid && !pruids.includes(pruid)) {
      pruids.push(pruid);
    }
  }

  return pruids.sort((left, right) => left.localeCompare(right));
}

export async function ensureSubmissionScopePruids(supabase, submission) {
  const submissionId = String(submission?.id ?? "").trim();
  if (!submissionId) {
    throw scopeError("submissionId is required.", { statusCode: 400, code: "INVALID_SUBMISSION" });
  }

  const { data: existing, error: existingError } = await supabase
    .from("submission_scope_pruids")
    .select("pruid")
    .eq("submission_id", submissionId);

  if (existingError) {
    throw scopeError(existingError.message, { statusCode: 500, code: "SCOPE_LOOKUP_FAILED" });
  }

  if (existing?.length) {
    return [...new Set(existing.map((row) => normalizePruid(row.pruid)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  }

  const derived = await deriveEligibilityPruids(
    submission.dguid ?? submission.primary_dguid,
    submission.neighboring_dguid ?? submission.secondary_dguid,
  );

  if (!derived.length) {
    throw scopeError("Submission scope could not be derived from canonical DA profiles.", {
      statusCode: 500,
      code: "SCOPE_DERIVATION_FAILED",
    });
  }

  const { error: insertError } = await supabase
    .from("submission_scope_pruids")
    .insert(derived.map((pruid) => ({
      submission_id: submissionId,
      pruid,
    })));

  if (insertError && insertError.code !== "23505") {
    throw scopeError(insertError.message, { statusCode: 500, code: "SCOPE_PERSIST_FAILED" });
  }

  const { data: persisted, error: reloadError } = await supabase
    .from("submission_scope_pruids")
    .select("pruid")
    .eq("submission_id", submissionId);

  if (reloadError) {
    throw scopeError(reloadError.message, { statusCode: 500, code: "SCOPE_LOOKUP_FAILED" });
  }

  return [...new Set((persisted ?? []).map((row) => normalizePruid(row.pruid)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function buildScopeProjection(eligibilityPruids, commissionerPruid) {
  const unique = [...new Set((eligibilityPruids ?? []).map(normalizePruid).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const operatingPruid = normalizePruid(commissionerPruid);
  return {
    eligibilityPruids: unique,
    operatingPruid,
    isCrossProvince: unique.length > 1,
    crossProvinceWarning: formatCrossProvinceWarning(unique),
    isEligible: unique.includes(operatingPruid),
  };
}

/**
 * Authorize a Commissioner against a submission's one-/two-PRUID eligibility set.
 * Unrelated provinces receive a non-disclosing 404.
 */
export async function authorizeSubmissionScope(supabase, {
  submission,
  commissionerProfile,
  requireClaim = false,
} = {}) {
  const commissionerPruid = resolveCommissionerPruid(commissionerProfile);
  if (!commissionerPruid) {
    throw missingCommissionerProvinceError();
  }

  const eligibilityPruids = await ensureSubmissionScopePruids(supabase, submission);
  const projection = buildScopeProjection(eligibilityPruids, commissionerPruid);

  if (!projection.isEligible) {
    throw notFoundScopeError();
  }

  const activeClaimPruid = normalizePruid(submission?.active_claim_pruid) || null;
  if (
    requireClaim
    && activeClaimPruid
    && activeClaimPruid !== commissionerPruid
  ) {
    throw resourceAlreadyClaimedError(activeClaimPruid);
  }

  return {
    ...projection,
    activeClaimPruid,
    activeClaimKind: submission?.active_claim_kind ?? null,
  };
}

export async function projectSubmissionScope(submission, commissionerProfile) {
  const commissionerPruid = resolveCommissionerPruid(commissionerProfile);
  if (!commissionerPruid) {
    return null;
  }

  const eligibilityPruids = await deriveEligibilityPruids(
    submission?.dguid ?? submission?.primary_dguid,
    submission?.neighboring_dguid ?? submission?.secondary_dguid,
  );

  if (!eligibilityPruids.length) {
    return buildScopeProjection([], commissionerPruid);
  }

  return buildScopeProjection(eligibilityPruids, commissionerPruid);
}

export async function filterSubmissionsForCommissionerScope(rows, commissionerProfile) {
  const commissionerPruid = resolveCommissionerPruid(commissionerProfile);
  if (!commissionerPruid) {
    throw missingCommissionerProvinceError();
  }

  const filtered = [];
  for (const row of rows ?? []) {
    const projection = await projectSubmissionScope(row, commissionerProfile);
    if (!projection?.isEligible) continue;
    filtered.push({
      ...row,
      scope_pruids: projection.eligibilityPruids,
      operating_pruid: projection.operatingPruid,
      cross_province_warning: projection.crossProvinceWarning,
    });
  }
  return filtered;
}

export async function claimSubmissionForOperation(supabase, {
  submissionId,
  expectedVersion,
  operatingPruid,
  actorProfileId,
  claimKind,
}) {
  const now = new Date().toISOString();
  let query = supabase
    .from("submissions")
    .update({
      active_claim_pruid: operatingPruid,
      active_claim_kind: claimKind,
      active_claim_actor_id: actorProfileId,
      active_claim_at: now,
      updated_at: now,
    })
    .eq("id", submissionId)
    .or(`active_claim_pruid.is.null,active_claim_pruid.eq.${operatingPruid}`);

  if (expectedVersion !== null && expectedVersion !== undefined) {
    query = query.eq("resource_version", expectedVersion);
  }

  const { data, error } = await query
    .select("id,status,resource_version,updated_at,active_claim_pruid,active_claim_kind,dguid,neighboring_dguid")
    .maybeSingle();

  if (error) {
    throw scopeError(error.message, { statusCode: 500, code: "CLAIM_FAILED" });
  }

  if (!data) {
    const { data: latest } = await supabase
      .from("submissions")
      .select("id,resource_version,active_claim_pruid,active_claim_kind,dguid,neighboring_dguid,status,updated_at")
      .eq("id", submissionId)
      .maybeSingle();

    if (!latest) {
      throw notFoundScopeError();
    }

    const claim = normalizePruid(latest.active_claim_pruid);
    if (claim && claim !== normalizePruid(operatingPruid)) {
      throw resourceAlreadyClaimedError(claim);
    }

    const stale = scopeError(
      "The submission was updated by another Commissioner.",
      { statusCode: 409, code: "STALE_RESOURCE_VERSION" },
    );
    stale.current = latest;
    throw stale;
  }

  return data;
}

export async function clearSubmissionClaim(supabase, {
  submissionId,
  expectedClaimPruid = null,
} = {}) {
  let query = supabase
    .from("submissions")
    .update({
      active_claim_pruid: null,
      active_claim_kind: null,
      active_claim_actor_id: null,
      active_claim_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (expectedClaimPruid) {
    query = query.eq("active_claim_pruid", expectedClaimPruid);
  }

  const { error } = await query;
  if (error) {
    throw scopeError(error.message, { statusCode: 500, code: "CLAIM_CLEAR_FAILED" });
  }
}
