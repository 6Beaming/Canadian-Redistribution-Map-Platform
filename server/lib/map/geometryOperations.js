import crypto from "node:crypto";
import { loadCurrentCanonicalRelease, readSharedArcRecord } from "./canonicalReleaseStore.js";
import { loadCanonicalRelease, readCanonicalDaPair } from "./canonicalReleaseStore.js";
import { CounterProposalValidationError } from "./counterProposalSubmission.js";

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
  const pair = await readCanonicalDaPair(
    release,
    descriptor.primary_dguid,
    descriptor.secondary_dguid,
    { representation: "display", lod: "auto" },
  );
  if (!operations.length) return pair.features;
  const shared = await readSharedArcRecord(
    release,
    [descriptor.primary_dguid, descriptor.secondary_dguid].sort().join("|"),
  );
  const baseByVertex = new Map(shared.chains.flatMap((chain) =>
    chain.vertices.map((vertex) => [vertex[0], [vertex[1], vertex[2]]]),
  ));
  const replacements = new Map();
  for (const operation of operations) {
    const base = baseByVertex.get(operation.vertex_id);
    if (!base) {
      throw new CounterProposalValidationError(`Unknown release vertex: ${operation.vertex_id}.`);
    }
    replacements.set(coordinateKey(base), [Number(operation.to_lng), Number(operation.to_lat)]);
  }
  return {
    type: "FeatureCollection",
    features: pair.features.features.map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: replaceCoordinates(feature.geometry?.coordinates, replacements),
      },
    })),
  };
}
