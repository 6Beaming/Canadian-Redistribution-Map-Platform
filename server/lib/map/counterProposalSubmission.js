import {
  buildCounterProposalCache,
  validateCounterProposalTopology,
} from "../../../src/lib/map/counterProposalWorkflow.js";
import {
  buildDaObjectionIndex,
  getPairOuterBoundaryFeatureCollection,
  getSharedBoundaryFeatureCollection,
} from "../../../src/lib/map/objectionWorkflow.js";
import {
  loadPairObjectionIndex,
  MapAssetValidationError,
  normalizeFedNum,
} from "./mapAssetAuthority.js";
import { calculateCounterProposalImpact } from "../../../src/lib/map/counterProposalImpact.js";
import { deriveEligibilityPruids } from "../authorization/resourceScopeGuard.js";
import { loadCanonicalRelease } from "./canonicalReleaseStore.js";
import {
  materializeCounterProposalFromOperations,
  validateAndNormalizeSubmissionOperations,
} from "./geometryOperations.js";

export { MapAssetValidationError };

export class CounterProposalValidationError extends Error {
  constructor(message, validationReport = {}) {
    super(message);
    this.name = "CounterProposalValidationError";
    this.statusCode = validationReport.statusCode || 400;
    this.code = validationReport.code || "INVALID_COUNTER_PROPOSAL";
    this.publicMessage = message;
    this.validationReport = validationReport;
  }
}

function createFeatureCollection(features = []) {
  return {
    type: "FeatureCollection",
    features,
  };
}

function getFeatureDguid(feature) {
  return String(feature?.properties?.DGUID ?? feature?.id ?? "").trim();
}

function normalizeText(value, fieldName, { required = true, maxLength = 5000 } = {}) {
  const text = String(value ?? "").trim();

  if (required && !text) {
    throw new CounterProposalValidationError(`${fieldName} is required.`);
  }

  if (text.length > maxLength) {
    throw new CounterProposalValidationError(`${fieldName} must be at most ${maxLength} characters.`);
  }

  return text;
}

function normalizeProposedFeatures(proposedGeometry, firstDguid, secondDguid) {
  const features = Array.isArray(proposedGeometry?.features)
    ? proposedGeometry.features
    : null;

  if (!features || features.length !== 2) {
    throw new CounterProposalValidationError(
      "proposed_geometry must be a FeatureCollection with exactly two features.",
    );
  }

  const featureDguids = features.map(getFeatureDguid);
  const expected = new Set([firstDguid, secondDguid]);

  if (!featureDguids.every((dguid) => expected.has(dguid))) {
    throw new CounterProposalValidationError(
      "proposed_geometry features must match the selected DA pair.",
    );
  }

  return features;
}

export async function prepareCounterProposalSubmission(body = {}) {
  const primaryDguid = String(body.dguid ?? body.primary_dguid ?? "").trim();
  const secondaryDguid = String(body.neighboring_dguid ?? body.secondary_dguid ?? "").trim();
  const title = normalizeText(body.title, "title", { maxLength: 200 });
  const comment = normalizeText(body.comment, "comment");
  const requestedFedNum = normalizeFedNum(body.fed_num);

  const pairContext = await loadPairObjectionIndex(primaryDguid, secondaryDguid);
  const {
    index,
    firstDguid,
    secondDguid,
    firstFedNum,
    profilesByDguid,
    baselineRevision,
    releaseId,
  } = pairContext;

  if (requestedFedNum && requestedFedNum !== firstFedNum) {
    throw new CounterProposalValidationError(
      "fed_num does not match the selected primary DA.",
    );
  }

  const proposedFeatures = normalizeProposedFeatures(
    body.proposed_geometry,
    firstDguid,
    secondDguid,
  );

  const baselineCache = buildCounterProposalCache(
    index,
    profilesByDguid,
    firstDguid,
    secondDguid,
  );

  if (!baselineCache) {
    throw new CounterProposalValidationError("Unable to build the canonical DA pair baseline.");
  }

  if (baselineCache.sourceGeometryIssues?.length) {
    throw new CounterProposalValidationError(
      "The selected DA pair cannot be edited with the current canonical metadata.",
      {
        sourceGeometryIssues: baselineCache.sourceGeometryIssues,
      },
    );
  }

  const validationReport = validateCounterProposalTopology(
    baselineCache.originalFeatures,
    proposedFeatures,
  );

  if (!validationReport.valid) {
    throw new CounterProposalValidationError(
      "The proposed boundary geometry failed server topology validation.",
      validationReport,
    );
  }

  const proposedIndex = buildDaObjectionIndex(createFeatureCollection(proposedFeatures));

  const originalGeometry = createFeatureCollection(baselineCache.originalFeatures);
  const proposedGeometry = createFeatureCollection(proposedFeatures);
  const sharedBoundary = getSharedBoundaryFeatureCollection(
    proposedIndex,
    firstDguid,
    secondDguid,
  );
  const outerBoundary = getPairOuterBoundaryFeatureCollection(
    proposedIndex,
    [firstDguid, secondDguid],
  );
  const impactSummary = calculateCounterProposalImpact({
    originalFeatures: baselineCache.originalFeatures,
    proposedFeatures,
    firstDguid,
    secondDguid,
    populationByDguid: Object.fromEntries([
      [firstDguid, profilesByDguid.get(firstDguid)?.population ?? null],
      [secondDguid, profilesByDguid.get(secondDguid)?.population ?? null],
    ]),
  });

  return {
    submission: {
      user_id: null,
      type: "counter_proposal",
      fed_num: firstFedNum,
      dguid: firstDguid,
      neighboring_dguid: secondDguid,
      title,
      comment,
      geometry: proposedGeometry,
      status: "pending",
      release_id: releaseId,
    },
    revision: {
      revision_number: 1,
      primary_dguid: firstDguid,
      secondary_dguid: secondDguid,
      original_geometry: originalGeometry,
      proposed_geometry: proposedGeometry,
      shared_boundary: sharedBoundary,
      outer_boundary: outerBoundary,
      baseline_revision: baselineRevision,
      validation_report: {
        ...validationReport,
        impact_summary: impactSummary,
        baseline_revision: baselineRevision,
      },
    },
  };
}

function assertReleaseIdentityMatches(body, activeRelease) {
  const releaseId = String(body.releaseId ?? "").trim();
  const baseRevision = String(body.baseRevision ?? "").trim();
  if (!releaseId || !baseRevision) {
    throw new CounterProposalValidationError("releaseId and baseRevision are required.", {
      code: "INVALID_COUNTER_PROPOSAL",
      statusCode: 400,
    });
  }
  if (
    releaseId !== activeRelease.releaseId
    || baseRevision !== activeRelease.geometryRevision
  ) {
    throw new CounterProposalValidationError(
      "The submitted release identity does not match the active map release.",
      {
        code: "MAP_RELEASE_MISMATCH",
        statusCode: 409,
      },
    );
  }
}

export async function prepareCounterProposalSubmissionV2(body = {}, activeRelease) {
  const primaryDguid = String(body.primaryDguid ?? body.dguid ?? "").trim();
  const secondaryDguid = String(body.secondaryDguid ?? body.neighboring_dguid ?? "").trim();
  const title = normalizeText(body.title, "title", { maxLength: 200 });
  const comment = normalizeText(body.comment, "comment");
  assertReleaseIdentityMatches(body, activeRelease);

  const pairContext = await loadPairObjectionIndex(primaryDguid, secondaryDguid);
  const {
    index,
    firstDguid,
    secondDguid,
    firstFedNum,
    profilesByDguid,
    baselineRevision,
    releaseId,
  } = pairContext;

  if (releaseId !== activeRelease.releaseId || baselineRevision !== activeRelease.geometryRevision) {
    throw new CounterProposalValidationError(
      "The selected DA pair does not match the active map release.",
      {
        code: "STALE_COUNTER_PROPOSAL_DRAFT",
        statusCode: 409,
      },
    );
  }

  const release = loadCanonicalRelease(releaseId);
  const normalized = await validateAndNormalizeSubmissionOperations({
    release,
    primaryDguid: firstDguid,
    secondaryDguid: secondDguid,
    operations: body.operations,
  });
  const materialized = await materializeCounterProposalFromOperations({
    release,
    primaryDguid: normalized.primaryDguid,
    secondaryDguid: normalized.secondaryDguid,
    operations: normalized.operations,
  });

  const validationReport = validateCounterProposalTopology(
    materialized.originalFeatures,
    materialized.proposedFeatures,
  );

  if (!validationReport.valid) {
    throw new CounterProposalValidationError(
      "The proposed boundary geometry failed server topology validation.",
      {
        ...validationReport,
        code: "COUNTER_PROPOSAL_TOPOLOGY_INVALID",
        statusCode: 422,
      },
    );
  }

  const proposedIndex = buildDaObjectionIndex(createFeatureCollection(materialized.proposedFeatures));
  const sharedBoundary = getSharedBoundaryFeatureCollection(
    proposedIndex,
    firstDguid,
    secondDguid,
  );
  const outerBoundary = getPairOuterBoundaryFeatureCollection(
    proposedIndex,
    [firstDguid, secondDguid],
  );
  const impactSummary = calculateCounterProposalImpact({
    originalFeatures: materialized.originalFeatures,
    proposedFeatures: materialized.proposedFeatures,
    firstDguid,
    secondDguid,
    populationByDguid: Object.fromEntries([
      [firstDguid, profilesByDguid.get(firstDguid)?.population ?? null],
      [secondDguid, profilesByDguid.get(secondDguid)?.population ?? null],
    ]),
  });

  const scopePruids = await deriveEligibilityPruids(firstDguid, secondDguid);

  return {
    submission: {
      user_id: null,
      type: "counter_proposal",
      fed_num: firstFedNum,
      dguid: firstDguid,
      neighboring_dguid: secondDguid,
      title,
      comment,
      status: "pending",
      release_id: releaseId,
    },
    compact: {
      releaseId,
      baseRevision: baselineRevision,
      primaryDguid: normalized.primaryDguid,
      secondaryDguid: normalized.secondaryDguid,
      geometryDigest: materialized.geometryDigest,
      operations: normalized.operations,
    },
    validationReport: {
      ...validationReport,
      impact_summary: impactSummary,
      baseline_revision: baselineRevision,
      shared_boundary: sharedBoundary,
      outer_boundary: outerBoundary,
      operationCount: normalized.operations.length,
    },
    scopePruids,
  };
}
