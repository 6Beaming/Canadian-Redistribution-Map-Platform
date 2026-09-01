import crypto from "node:crypto";
import { loadCurrentCanonicalRelease } from "../map/canonicalReleaseStore.js";
import { materializeGeometryOperations } from "../map/geometryOperations.js";
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
  if (type === "comment" || type === "feedback") {
    return `comment:${release}:${primary}`;
  }
  const pair = canonicalPair(primary, secondaryDguid);
  if (pair.length !== 2 || pair[0] === pair[1]) {
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

function featureByDguid(collection, dguid) {
  return (collection?.features ?? []).find((feature) =>
    String(feature?.properties?.DGUID ?? feature?.id ?? "") === String(dguid));
}

export async function buildCounterProposalMergePayload(supabase, {
  releaseId,
  primaryDguid,
  secondaryDguid,
  geometryRevision,
  operations = [],
}) {
  const pair = canonicalPair(primaryDguid, secondaryDguid);
  const displayGeometry = await materializeGeometryOperations(geometryRevision, operations);
  const resultGeometry = displayGeometry;
  const headGeometry = {};
  const headDisplayGeometry = {};
  const afterDigests = {};
  const beforeDigests = {};

  for (const dguid of pair) {
    const { data: existingHead } = await supabase
      .from("archive_map_da_heads")
      .select("dguid, uses_base, geometry_digest")
      .eq("release_id", releaseId)
      .eq("dguid", dguid)
      .maybeSingle();
    beforeDigests[dguid] = existingHead?.geometry_digest
      ?? geometryDigest(featureByDguid(displayGeometry, dguid)?.geometry ?? null);

    const feature = featureByDguid(displayGeometry, dguid);
    headGeometry[dguid] = feature ?? null;
    headDisplayGeometry[dguid] = feature ?? null;
    afterDigests[dguid] = geometryDigest(feature?.geometry ?? null);
  }

  return {
    resultGeometry,
    displayGeometry,
    geometryDigest: geometryDigest(pair.map((dguid) => featureByDguid(resultGeometry, dguid)?.geometry)),
    branchVertexSnapshot: {
      sourceGeometryRevisionId: geometryRevision.id,
      ownedVertexIds: operations.map((operation) => operation.vertex_id),
    },
    validationReport: geometryRevision.validation_report ?? {},
    operations: operations.map((operation, operation_index) => ({
      operation_index,
      vertex_id: operation.vertex_id,
      from_lng: operation.base_lng,
      from_lat: operation.base_lat,
      to_lng: operation.to_lng,
      to_lat: operation.to_lat,
      source_submission_operation_index: operation.operation_index,
    })),
    affectedDguids: pair,
    headGeometry,
    headDisplayGeometry,
    beforeDigests,
    afterDigests,
  };
}

export async function buildCounterProposalRevertPayload(supabase, {
  releaseId,
  primaryDguid,
  secondaryDguid,
  targetVertexSnapshot,
  geometryRevision,
  operations = [],
}) {
  return buildCounterProposalMergePayload(supabase, {
    releaseId,
    primaryDguid,
    secondaryDguid,
    geometryRevision,
    operations,
  }).then((payload) => ({
    ...payload,
    branchVertexSnapshot: targetVertexSnapshot ?? payload.branchVertexSnapshot,
    usesBase: Object.fromEntries(payload.affectedDguids.map((dguid) => [dguid, false])),
  }));
}

export async function buildCounterProposalDeletePayload(supabase, {
  releaseId,
  primaryDguid,
  secondaryDguid,
}) {
  const release = loadCurrentCanonicalRelease();
  const pair = canonicalPair(primaryDguid, secondaryDguid);
  const beforeDigests = {};
  const afterDigests = {};

  for (const dguid of pair) {
    const descriptor = release.dguids[dguid];
    const baseDigest = descriptor?.sha256 ?? geometryDigest(null);
    const { data: existingHead } = await supabase
      .from("archive_map_da_heads")
      .select("geometry_digest")
      .eq("release_id", releaseId)
      .eq("dguid", dguid)
      .maybeSingle();
    beforeDigests[dguid] = existingHead?.geometry_digest ?? baseDigest;
    afterDigests[dguid] = baseDigest;
  }

  return {
    affectedDguids: pair,
    beforeDigests,
    afterDigests,
  };
}
