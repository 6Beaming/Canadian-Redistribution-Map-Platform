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

export { MapAssetValidationError };

export class CounterProposalValidationError extends Error {
  constructor(message, validationReport = {}) {
    super(message);
    this.name = "CounterProposalValidationError";
    this.statusCode = 400;
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
