import crypto from "node:crypto";
import { loadCurrentCanonicalRelease, readCanonicalDaPair, readSharedArcRecord } from "./canonicalReleaseStore.js";
import { loadCanonicalRelease } from "./canonicalReleaseStore.js";
import { CounterProposalValidationError } from "./counterProposalSubmission.js";
import { getMaterializationContext } from "./materializationContext.js";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function coordinateKey(coordinate) {
  return `${Number(coordinate[0]).toFixed(8)},${Number(coordinate[1]).toFixed(8)}`;
}

function canonicalPair(first, second) {
  return [String(first ?? "").trim(), String(second ?? "").trim()].sort();
}

function featuresByDguid(collection) {
  return new Map((collection?.features ?? []).map((feature) => [
    String(feature?.properties?.DGUID ?? feature?.id ?? "").trim(),
    feature,
  ]));
}

function walkCoordinatePairs(original, proposed, visit, location = []) {
  const originalLeaf = Array.isArray(original) && original.length >= 2 && original.slice(0, 2).every(Number.isFinite);
  const proposedLeaf = Array.isArray(proposed) && proposed.length >= 2 && proposed.slice(0, 2).every(Number.isFinite);
  if (originalLeaf || proposedLeaf) {
    if (!originalLeaf || !proposedLeaf) {
      throw new CounterProposalValidationError(`Geometry structure changed at ${location.join(".")}.`);
    }
    visit(original, proposed);
    return;
  }
  if (!Array.isArray(original) || !Array.isArray(proposed) || original.length !== proposed.length) {
    throw new CounterProposalValidationError(`Geometry structure changed at ${location.join(".")}.`);
  }
  original.forEach((value, index) => walkCoordinatePairs(value, proposed[index], visit, [...location, index]));
}

export async function deriveCounterProposalOperations({
  primaryDguid,
  secondaryDguid,
  originalGeometry,
  proposedGeometry,
}) {
  const release = loadCurrentCanonicalRelease();
  const pair = canonicalPair(primaryDguid, secondaryDguid);
  const shared = await readSharedArcRecord(release, pair.join("|"));
  const vertexByCoordinate = new Map(shared.chains.flatMap((chain) =>
    chain.vertices.map((vertex) => [coordinateKey([vertex[1], vertex[2]]), {
      vertexId: vertex[0],
      base: [vertex[1], vertex[2]],
      locked: Boolean(vertex[3]),
    }]),
  ));
  const originalByDguid = featuresByDguid(originalGeometry);
  const proposedByDguid = featuresByDguid(proposedGeometry);
  const operationByVertex = new Map();
  for (const dguid of pair) {
    const original = originalByDguid.get(dguid);
    const proposed = proposedByDguid.get(dguid);
    if (!original || !proposed) {
      throw new CounterProposalValidationError(`Counter-Proposal geometry is missing ${dguid}.`);
    }
    walkCoordinatePairs(original.geometry?.coordinates, proposed.geometry?.coordinates, (from, to) => {
      if (coordinateKey(from) === coordinateKey(to)) return;
      const vertex = vertexByCoordinate.get(coordinateKey(from));
      if (!vertex || vertex.locked) {
        throw new CounterProposalValidationError("Only unlocked vertices on the canonical shared boundary may move.");
      }
      const candidate = {
        vertex_id: vertex.vertexId,
        operation_type: "set_vertex",
        base_lng: vertex.base[0],
        base_lat: vertex.base[1],
        to_lng: Number(to[0]),
        to_lat: Number(to[1]),
      };
      const existing = operationByVertex.get(vertex.vertexId);
      if (existing && (existing.to_lng !== candidate.to_lng || existing.to_lat !== candidate.to_lat)) {
        throw new CounterProposalValidationError("Shared vertex occurrences must resolve to one coordinate.");
      }
      operationByVertex.set(vertex.vertexId, candidate);
    });
  }
  return {
    releaseId: release.manifest.releaseId,
    baseRevision: release.manifest.geometryRevision,
    primaryDguid: pair[0],
    secondaryDguid: pair[1],
    geometryDigest: digest(pair.map((dguid) => proposedByDguid.get(dguid)?.geometry)),
    operations: [...operationByVertex.values()].sort((a, b) => a.vertex_id.localeCompare(b.vertex_id)),
  };
}

export async function persistSubmissionGeometryRevision(supabase, {
  submission,
  submissionType,
  compact,
  validationReport,
  legacyRevisionId = null,
}) {
  const { data: revision, error } = await supabase.from("submission_geometry_revisions").insert({
    submission_id: submission.id,
    submission_type: submissionType,
    revision_number: 1,
    release_id: compact.releaseId,
    base_revision: compact.baseRevision,
    primary_dguid: compact.primaryDguid,
    secondary_dguid: compact.secondaryDguid,
    geometry_digest: compact.geometryDigest,
    validation_report: { ...validationReport, operationCount: compact.operations.length },
    migration_state: "ready",
    migration_error: null,
    legacy_revision_id: legacyRevisionId,
    created_by: submission.user_id,
    created_at: submission.created_at,
  }).select("id,submission_id,revision_number,release_id,base_revision,primary_dguid,secondary_dguid,geometry_digest,validation_report,migration_state").single();
  if (error) throw error;
  if (compact.operations.length) {
    const { error: operationError } = await supabase.from("submission_geometry_operations").insert(
      compact.operations.map((operation, operation_index) => ({ revision_id: revision.id, operation_index, ...operation })),
    );
    if (operationError) throw operationError;
  }
  return revision;
}

export function buildZeroOperationGeometryDescriptor({ primaryDguid, secondaryDguid }) {
  const release = loadCurrentCanonicalRelease();
  const pair = canonicalPair(primaryDguid, secondaryDguid);
  const first = release.dguids[pair[0]];
  const second = release.dguids[pair[1]];
  if (!first || !second || !first.enabled || !second.enabled || !release.adjacency[pair[0]]?.includes(pair[1])) {
    throw new CounterProposalValidationError("The selected objection DAs are not available adjacent DAs.");
  }
  return {
    releaseId: release.manifest.releaseId,
    baseRevision: release.manifest.geometryRevision,
    primaryDguid: pair[0],
    secondaryDguid: pair[1],
    geometryDigest: digest(`${first.sha256}|${second.sha256}`),
    operations: [],
  };
}

function replaceCoordinates(value, replacements) {
  if (
    Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
  ) {
    return replacements.get(coordinateKey(value)) ?? value;
  }
  return Array.isArray(value)
    ? value.map((child) => replaceCoordinates(child, replacements))
    : value;
}

export async function materializeGeometryOperations(descriptor, operations = []) {
  const release = loadCanonicalRelease(descriptor.release_id);
  const pair = await readPairLayer(
    release,
    descriptor.primary_dguid,
    descriptor.secondary_dguid,
    { representation: "display", lod: "auto" },
  );
  if (!operations.length) return pair.features;
  const { vertexById } = await loadSharedVertexCatalog(
    release,
    descriptor.primary_dguid,
    descriptor.secondary_dguid,
  );
  const baseByVertex = new Map([...vertexById.entries()].map(([vertexId, vertex]) => [
    vertexId,
    vertex.base,
  ]));
  return applyOperationsToFeatureCollection(pair.features, operations, baseByVertex);
}

const MAX_SUBMISSION_OPERATIONS = 5000;

function normalizeOperationCoordinate(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    const error = new CounterProposalValidationError(`${fieldName} must be a finite number.`, {
      code: "INVALID_COUNTER_PROPOSAL",
      statusCode: 400,
    });
    throw error;
  }
  if (fieldName.endsWith("Lng") && (number < -180 || number > 180)) {
    throw new CounterProposalValidationError(`${fieldName} must be between -180 and 180.`, {
      code: "INVALID_COUNTER_PROPOSAL",
      statusCode: 400,
    });
  }
  if (fieldName.endsWith("Lat") && (number < -90 || number > 90)) {
    throw new CounterProposalValidationError(`${fieldName} must be between -90 and 90.`, {
      code: "INVALID_COUNTER_PROPOSAL",
      statusCode: 400,
    });
  }
  return Number(number.toFixed(8));
}

async function loadSharedVertexCatalog(release, primaryDguid, secondaryDguid) {
  const context = getMaterializationContext();
  if (context) {
    return context.getVertexCatalog(release, primaryDguid, secondaryDguid);
  }
  const pair = canonicalPair(primaryDguid, secondaryDguid);
  const shared = await readSharedArcRecord(release, pair.join("|"));
  const vertexById = new Map(shared.chains.flatMap((chain) =>
    chain.vertices.map((vertex) => [vertex[0], {
      vertexId: vertex[0],
      base: [vertex[1], vertex[2]],
      locked: Boolean(vertex[3]),
    }]),
  ));
  return { pair, vertexById };
}

function applyOperationsToFeatureCollection(collection, operations, baseByVertex) {
  if (!operations.length) return collection;
  const replacements = new Map();
  for (const operation of operations) {
    const vertexId = operation.vertex_id ?? operation.vertexId;
    const base = baseByVertex.get(vertexId);
    if (!base) {
      throw new CounterProposalValidationError(`Unknown release vertex: ${vertexId}.`, {
        code: "UNKNOWN_OR_LOCKED_VERTEX",
        statusCode: 422,
      });
    }
    replacements.set(coordinateKey(base), [
      Number(operation.to_lng ?? operation.toLng),
      Number(operation.to_lat ?? operation.toLat),
    ]);
  }
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: replaceCoordinates(feature.geometry?.coordinates, replacements),
      },
    })),
  };
}

async function readPairLayer(release, primaryDguid, secondaryDguid, options) {
  const context = getMaterializationContext();
  if (context) {
    return context.getCanonicalDaPair(release, primaryDguid, secondaryDguid, options);
  }
  return readCanonicalDaPair(release, primaryDguid, secondaryDguid, options);
}

export async function validateAndNormalizeSubmissionOperations({
  release,
  primaryDguid,
  secondaryDguid,
  operations = [],
}) {
  if (!Array.isArray(operations) || !operations.length) {
    throw new CounterProposalValidationError("At least one vertex operation is required.", {
      code: "INVALID_COUNTER_PROPOSAL",
      statusCode: 400,
    });
  }
  if (operations.length > MAX_SUBMISSION_OPERATIONS) {
    throw new CounterProposalValidationError("Too many vertex operations were submitted.", {
      code: "INVALID_COUNTER_PROPOSAL",
      statusCode: 400,
    });
  }

  const { pair, vertexById } = await loadSharedVertexCatalog(release, primaryDguid, secondaryDguid);
  const normalizedByVertex = new Map();

  for (const operation of operations) {
    const vertexId = String(operation?.vertexId ?? operation?.vertex_id ?? "").trim();
    if (!vertexId) {
      throw new CounterProposalValidationError("Each operation must include vertexId.", {
        code: "INVALID_COUNTER_PROPOSAL",
        statusCode: 400,
      });
    }
    if (normalizedByVertex.has(vertexId)) {
      throw new CounterProposalValidationError("Duplicate vertexId values are not allowed.", {
        code: "INVALID_COUNTER_PROPOSAL",
        statusCode: 400,
      });
    }
    const vertex = vertexById.get(vertexId);
    if (!vertex || vertex.locked) {
      throw new CounterProposalValidationError("Operation references an unknown or locked vertex.", {
        code: "UNKNOWN_OR_LOCKED_VERTEX",
        statusCode: 422,
      });
    }
    const toLng = normalizeOperationCoordinate(operation.toLng ?? operation.to_lng, "toLng");
    const toLat = normalizeOperationCoordinate(operation.toLat ?? operation.to_lat, "toLat");
    if (
      coordinateKey(vertex.base) === coordinateKey([toLng, toLat])
    ) {
      continue;
    }
    normalizedByVertex.set(vertexId, {
      vertex_id: vertexId,
      operation_type: "set_vertex",
      base_lng: vertex.base[0],
      base_lat: vertex.base[1],
      to_lng: toLng,
      to_lat: toLat,
    });
  }

  if (!normalizedByVertex.size) {
    throw new CounterProposalValidationError("At least one vertex operation is required.", {
      code: "INVALID_COUNTER_PROPOSAL",
      statusCode: 400,
    });
  }

  return {
    primaryDguid: pair[0],
    secondaryDguid: pair[1],
    operations: [...normalizedByVertex.values()].sort((left, right) =>
      left.vertex_id.localeCompare(right.vertex_id),
    ),
  };
}

export async function materializeCounterProposalFromOperations({
  release,
  primaryDguid,
  secondaryDguid,
  operations = [],
}) {
  const [editPair, displayPair, { vertexById }] = await Promise.all([
    readPairLayer(release, primaryDguid, secondaryDguid, { representation: "edit", lod: "auto" }),
    readPairLayer(release, primaryDguid, secondaryDguid, { representation: "display", lod: "auto" }),
    loadSharedVertexCatalog(release, primaryDguid, secondaryDguid),
  ]);
  const baseByVertex = new Map([...vertexById.entries()].map(([vertexId, vertex]) => [
    vertexId,
    vertex.base,
  ]));
  const proposedGeometry = applyOperationsToFeatureCollection(
    displayPair.features,
    operations,
    baseByVertex,
  );
  const context = getMaterializationContext();
  const digestKey = `proposed:${release.manifest.releaseId}:${primaryDguid}|${secondaryDguid}:${operations.length}`;
  const geometryDigestValue = context
    ? context.rememberDigest(digestKey, digest(proposedGeometry.features.map((feature) => feature.geometry)))
    : digest(proposedGeometry.features.map((feature) => feature.geometry));
  return {
    originalFeatures: editPair.features.features,
    proposedFeatures: proposedGeometry.features,
    proposedGeometry,
    geometryDigest: geometryDigestValue,
  };
}

export async function createCounterProposalSubmissionV2(supabase, {
  userId,
  title,
  comment,
  releaseId,
  baseRevision,
  primaryDguid,
  secondaryDguid,
  fedNum,
  geometryDigest,
  validationReport,
  operations,
  scopePruids,
}) {
  const { data, error } = await supabase.rpc("create_counter_proposal_submission_v2", {
    p_user_id: userId,
    p_title: title,
    p_comment: comment,
    p_release_id: releaseId,
    p_base_revision: baseRevision,
    p_primary_dguid: primaryDguid,
    p_secondary_dguid: secondaryDguid,
    p_fed_num: fedNum,
    p_geometry_digest: geometryDigest,
    p_validation_report: validationReport,
    p_operations: operations,
    p_scope_pruids: scopePruids,
  });
  if (error) {
    throw error;
  }
  return data;
}
