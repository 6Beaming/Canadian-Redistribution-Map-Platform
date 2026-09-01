import crypto from "node:crypto";
import {
  loadCanonicalRelease,
  loadCurrentCanonicalRelease,
  readCanonicalDaPair,
  readSharedArcRecord,
} from "../map/canonicalReleaseStore.js";
import { validateCounterProposalTopology } from "../../../src/lib/map/counterProposalWorkflow.js";
import { archiveError } from "./archiveErrors.js";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function geometryDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function canonicalPair(first, second) {
  return [String(first ?? "").trim(), String(second ?? "").trim()].sort();
}

export function buildArchiveBranchKey(submissionType, releaseId, primaryDguid, secondaryDguid = null) {
  const type = String(submissionType ?? "comment").replaceAll("-", "_");
  const release = String(releaseId ?? "").trim();
  const primary = String(primaryDguid ?? "").trim();
  if (!release || !primary) {
    throw archiveError("Archive branch identity is incomplete.", {
      statusCode: 400,
      code: "ARCHIVE_BRANCH_IDENTITY_INVALID",
    });
  }
  if (type === "comment" || type === "feedback") return `comment:${release}:${primary}`;
  const pair = canonicalPair(primary, secondaryDguid);
  if (pair.length !== 2 || !pair[0] || !pair[1] || pair[0] === pair[1]) {
    throw archiveError("Boundary archive branches require two distinct DGUIDs.", {
      statusCode: 400,
      code: "ARCHIVE_BRANCH_IDENTITY_INVALID",
    });
  }
  const prefix = type === "objection" ? "objection" : "counter-proposal";
  return `${prefix}:${release}:${pair.join("|")}`;
}

export function normalizeArchiveSubmissionType(value) {
  const type = String(value ?? "feedback").trim().toLowerCase().replaceAll("-", "_");
  if (["feedback", "comment", "comments"].includes(type)) return "comment";
  if (type === "objection") return "objection";
  if (["counterproposal", "counter_proposal"].includes(type)) return "counter_proposal";
  return "comment";
}

function coordinateKey(coordinate) {
  return `${Number(coordinate?.[0]).toFixed(8)},${Number(coordinate?.[1]).toFixed(8)}`;
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

function cloneFeatureWithReplacements(feature, replacements) {
  return {
    ...feature,
    properties: { ...(feature?.properties ?? {}) },
    geometry: {
      ...feature.geometry,
      coordinates: replaceCoordinates(feature.geometry?.coordinates, replacements),
    },
  };
}

function featureDguid(feature) {
  return String(feature?.properties?.DGUID ?? feature?.properties?.dguid ?? feature?.id ?? "");
}

function featureByDguid(collection, dguid) {
  return (collection?.features ?? []).find((feature) => featureDguid(feature) === String(dguid));
}

async function loadBranchState(supabase, { branchId, branchKey }) {
  let id = branchId ?? null;
  if (!id && branchKey) {
    const { data, error } = await supabase
      .from("archive_branches")
      .select("id")
      .eq("branch_key", branchKey)
      .maybeSingle();
    if (error) throw archiveError(error.message, { code: "ARCHIVE_GEOMETRY_LOOKUP_FAILED" });
    id = data?.id ?? null;
  }
  if (!id) return { branchId: null, vertices: new Map() };
  const { data, error } = await supabase
    .from("archive_vertex_state")
    .select("vertex_id,lng,lat,last_merge_sequence,last_version_id")
    .eq("branch_id", id);
  if (error) throw archiveError(error.message, { code: "ARCHIVE_GEOMETRY_LOOKUP_FAILED" });
  return {
    branchId: id,
    vertices: new Map((data ?? []).map((row) => [row.vertex_id, {
      vertexId: row.vertex_id,
      lng: Number(row.lng),
      lat: Number(row.lat),
    }])),
  };
}

async function loadCurrentPair(supabase, release, pair) {
  const base = await readCanonicalDaPair(release, pair[0], pair[1], { representation: "display" });
  const { data: heads, error } = await supabase
    .from("archive_map_da_heads")
    .select("dguid,uses_base,geometry,display_geometry,geometry_digest,resource_version")
    .eq("release_id", release.manifest.releaseId)
    .in("dguid", pair);
  if (error) throw archiveError(error.message, { code: "ARCHIVE_GEOMETRY_LOOKUP_FAILED" });
  const headsByDguid = new Map((heads ?? []).map((head) => [String(head.dguid), head]));
  const exactFeatures = pair.map((dguid) => {
    const head = headsByDguid.get(dguid);
    return head && !head.uses_base && head.geometry
      ? head.geometry
      : featureByDguid(base.features, dguid);
  });
  const displayFeatures = pair.map((dguid) => {
    const head = headsByDguid.get(dguid);
    return head && !head.uses_base && head.display_geometry
      ? head.display_geometry
      : featureByDguid(base.features, dguid);
  });
  return {
    base: base.features,
    headsByDguid,
    exact: { type: "FeatureCollection", features: exactFeatures },
    display: { type: "FeatureCollection", features: displayFeatures },
  };
}

async function loadBaseVertices(release, pair) {
  const shared = await readSharedArcRecord(release, pair.join("|"));
  return new Map(shared.chains.flatMap((chain) => chain.vertices.map((vertex) => [vertex[0], {
    vertexId: vertex[0],
    lng: Number(vertex[1]),
    lat: Number(vertex[2]),
    locked: Boolean(vertex[3]),
  }])));
}

function snapshotVertices(vertices) {
  return [...vertices.values()]
    .sort((left, right) => left.vertexId.localeCompare(right.vertexId))
    .map(({ vertexId, lng, lat }) => ({ vertexId, lng, lat }));
}

function normalizeSnapshot(snapshot) {
  const items = Array.isArray(snapshot?.vertices) ? snapshot.vertices : [];
  return new Map(items.map((item) => [String(item.vertexId), {
    vertexId: String(item.vertexId),
    lng: Number(item.lng),
    lat: Number(item.lat),
  }]));
}

function buildTransitionOperations(currentState, nextState, baseVertices, sourceOperations = []) {
  const sourceIndex = new Map(sourceOperations.map((operation) => [operation.vertex_id, operation.operation_index]));
  const vertexIds = new Set([...currentState.keys(), ...nextState.keys()]);
  return [...vertexIds].sort().flatMap((vertexId) => {
    const base = baseVertices.get(vertexId);
    const from = currentState.get(vertexId) ?? base;
    const to = nextState.get(vertexId) ?? base;
    if (!from || !to || (from.lng === to.lng && from.lat === to.lat)) return [];
    return [{
      operation_index: 0,
      vertex_id: vertexId,
      from_lng: from.lng,
      from_lat: from.lat,
      to_lng: to.lng,
      to_lat: to.lat,
      source_submission_operation_index: sourceIndex.get(vertexId) ?? null,
    }];
  }).map((operation, operationIndex) => ({ ...operation, operation_index: operationIndex }));
}

function applyStateTransition(collection, operations) {
  const replacements = new Map(operations.map((operation) => [
    coordinateKey([operation.from_lng, operation.from_lat]),
    [operation.to_lng, operation.to_lat],
  ]));
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => cloneFeatureWithReplacements(feature, replacements)),
  };
}

function assertLegalPair(currentGeometry, resultGeometry) {
  const report = validateCounterProposalTopology(currentGeometry.features, resultGeometry.features);
  if (!report.valid) {
    throw archiveError("The merge would make the Archived Map geometry invalid.", {
      statusCode: 409,
      code: "ARCHIVE_GEOMETRY_CONFLICT",
    });
  }
  return report;
}

async function materializeBranchTransition(supabase, {
  releaseId,
  primaryDguid,
  secondaryDguid,
  branchId,
  branchKey,
  targetState,
  sourceOperations = [],
}) {
  const release = loadCanonicalRelease(releaseId);
  const pair = canonicalPair(primaryDguid, secondaryDguid);
  const [currentPair, baseVertices, branchState, revisionResult] = await Promise.all([
    loadCurrentPair(supabase, release, pair),
    loadBaseVertices(release, pair),
    loadBranchState(supabase, { branchId, branchKey }),
    supabase
      .from("archive_map_revisions")
      .select("sequence")
      .eq("release_id", releaseId)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (revisionResult.error) {
    throw archiveError(revisionResult.error.message, { code: "ARCHIVE_GEOMETRY_LOOKUP_FAILED" });
  }
  const operations = buildTransitionOperations(
    branchState.vertices,
    targetState,
    baseVertices,
    sourceOperations,
  );
  const resultGeometry = applyStateTransition(currentPair.exact, operations);
  const displayGeometry = applyStateTransition(currentPair.display, operations);
  const topologyReport = assertLegalPair(currentPair.exact, resultGeometry);
  const headGeometry = {};
  const headDisplayGeometry = {};
  const beforeDigests = {};
  const afterDigests = {};
  const usesBase = {};
  pair.forEach((dguid) => {
    const resultFeature = featureByDguid(resultGeometry, dguid);
    const displayFeature = featureByDguid(displayGeometry, dguid);
    const baseFeature = featureByDguid(currentPair.base, dguid);
    const beforeFeature = featureByDguid(currentPair.exact, dguid);
    const baseDigest = geometryDigest(baseFeature?.geometry ?? null);
    const afterDigest = geometryDigest(resultFeature?.geometry ?? null);
    headGeometry[dguid] = resultFeature;
    headDisplayGeometry[dguid] = displayFeature;
    beforeDigests[dguid] = currentPair.headsByDguid.get(dguid)?.geometry_digest
      ?? geometryDigest(beforeFeature?.geometry ?? null);
    afterDigests[dguid] = afterDigest;
    usesBase[dguid] = afterDigest === baseDigest;
  });
  return {
    affectedDguids: pair,
    operations,
    branchVertexSnapshot: { vertices: snapshotVertices(targetState) },
    resultGeometry,
    displayGeometry,
    geometryDigest: geometryDigest(pair.map((dguid) => featureByDguid(resultGeometry, dguid)?.geometry)),
    validationReport: { ...topologyReport, archiveMapChecked: true },
    headGeometry,
    headDisplayGeometry,
    beforeDigests,
    afterDigests,
    usesBase,
    expectedMapRevision: Number(revisionResult.data?.sequence ?? 0),
  };
}

export async function buildCounterProposalMergePayload(supabase, {
  releaseId,
  primaryDguid,
  secondaryDguid,
  branchId,
  branchKey,
  geometryRevision,
  operations = [],
}) {
  const { vertices: currentState } = await loadBranchState(supabase, { branchId, branchKey });
  const targetState = new Map(currentState);
  operations.forEach((operation) => {
    targetState.set(operation.vertex_id, {
      vertexId: operation.vertex_id,
      lng: Number(operation.to_lng),
      lat: Number(operation.to_lat),
    });
  });
  const payload = await materializeBranchTransition(supabase, {
    releaseId,
    primaryDguid,
    secondaryDguid,
    branchId,
    branchKey,
    targetState,
    sourceOperations: operations,
  });
  return {
    ...payload,
    sourceGeometryRevisionId: geometryRevision.id,
    validationReport: {
      ...(geometryRevision.validation_report ?? {}),
      ...payload.validationReport,
    },
  };
}

export async function buildCounterProposalRevertPayload(supabase, {
  releaseId,
  primaryDguid,
  secondaryDguid,
  branchId,
  branchKey,
  targetVertexSnapshot,
}) {
  if (!Array.isArray(targetVertexSnapshot?.vertices)) {
    throw archiveError("The target archive version has no replayable vertex snapshot.", {
      statusCode: 409,
      code: "ARCHIVE_SOURCE_MISSING",
    });
  }
  return materializeBranchTransition(supabase, {
    releaseId,
    primaryDguid,
    secondaryDguid,
    branchId,
    branchKey,
    targetState: normalizeSnapshot(targetVertexSnapshot),
  });
}

export async function buildCounterProposalDeletePayload(supabase, {
  releaseId,
  primaryDguid,
  secondaryDguid,
  branchId,
  branchKey,
}) {
  return materializeBranchTransition(supabase, {
    releaseId,
    primaryDguid,
    secondaryDguid,
    branchId,
    branchKey,
    targetState: new Map(),
  });
}

export function currentReleaseId() {
  return loadCurrentCanonicalRelease().manifest.releaseId;
}
