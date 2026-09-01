#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalPair,
  loadLocalRelease,
  readRangeJson,
  redactError,
  requireAdminClient,
  sha256,
  stableJson,
} from "../reusable/map_release_db.mjs";

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apply = process.argv.includes("--apply");
const batchSize = Math.max(1, Math.min(500, Number(flag("--batch-size", "100"))));
const onlySubmissionId = flag("--submission-id");
const checkpointPath = path.resolve(flag("--checkpoint", "local/submission-geometry-backfill-checkpoint.json"));
const release = loadLocalRelease({ releaseId: flag("--release-id") });
const supabase = requireAdminClient();

function coordinateKey(coordinate) {
  return `${Number(coordinate[0]).toFixed(8)},${Number(coordinate[1]).toFixed(8)}`;
}

function geometryCoordinatesDigest(feature) {
  return sha256(stableJson(feature?.geometry?.coordinates ?? null));
}

function exactFeature(dguid) {
  const descriptor = release.dguids[dguid];
  if (!descriptor) throw new Error(`DGUID ${dguid} is missing from the local release.`);
  return readRangeJson(release, descriptor);
}

function sharedVertexCatalog(pair) {
  const key = pair.join("|");
  const descriptor = release.sharedArcs[key];
  if (!descriptor) throw new Error("The selected DAs are not adjacent in the local release.");
  const record = readRangeJson(release, descriptor);
  return new Map(record.chains.flatMap((chain) =>
    chain.vertices.map((vertex) => [coordinateKey([vertex[1], vertex[2]]), {
      vertexId: vertex[0],
      coordinate: [vertex[1], vertex[2]],
      locked: Boolean(vertex[3]),
    }]),
  ));
}

function featuresByDguid(collection) {
  return new Map((collection?.features ?? []).map((feature) => [
    String(feature?.properties?.DGUID ?? feature?.id ?? "").trim(),
    feature,
  ]));
}

function walkCoordinatePairs(original, proposed, visit, pathParts = []) {
  const originalLeaf = Array.isArray(original) && original.length >= 2 && original.slice(0, 2).every(Number.isFinite);
  const proposedLeaf = Array.isArray(proposed) && proposed.length >= 2 && proposed.slice(0, 2).every(Number.isFinite);
  if (originalLeaf || proposedLeaf) {
    if (!originalLeaf || !proposedLeaf) throw new Error(`Coordinate structure changed at ${pathParts.join(".")}.`);
    visit(original, proposed);
    return;
  }
  if (!Array.isArray(original) || !Array.isArray(proposed) || original.length !== proposed.length) {
    throw new Error(`Geometry structure changed at ${pathParts.join(".")}.`);
  }
  original.forEach((value, index) => walkCoordinatePairs(value, proposed[index], visit, [...pathParts, index]));
}

function convertCounterProposal(submission, legacyRevision) {
  const pair = canonicalPair(legacyRevision.primary_dguid, legacyRevision.secondary_dguid);
  const originalByDguid = featuresByDguid(legacyRevision.original_geometry);
  const proposedByDguid = featuresByDguid(legacyRevision.proposed_geometry);
  const vertices = sharedVertexCatalog(pair);
  const operations = new Map();
  for (const dguid of pair) {
    const exact = exactFeature(dguid);
    const original = originalByDguid.get(dguid);
    const proposed = proposedByDguid.get(dguid);
    if (!original || !proposed) throw new Error(`Legacy revision is missing ${dguid}.`);
    if (geometryCoordinatesDigest(exact) !== geometryCoordinatesDigest(original)) {
      throw new Error(`Legacy original geometry does not match release exact geometry for ${dguid}.`);
    }
    walkCoordinatePairs(original.geometry.coordinates, proposed.geometry.coordinates, (from, to) => {
      if (coordinateKey(from) === coordinateKey(to)) return;
      const vertex = vertices.get(coordinateKey(from));
      if (!vertex || vertex.locked) throw new Error("Legacy edit changes an unknown or locked shared vertex.");
      const existing = operations.get(vertex.vertexId);
      const candidate = {
        vertex_id: vertex.vertexId,
        operation_type: "set_vertex",
        base_lng: Number(from[0]), base_lat: Number(from[1]),
        to_lng: Number(to[0]), to_lat: Number(to[1]),
      };
      if (existing && (existing.to_lng !== candidate.to_lng || existing.to_lat !== candidate.to_lat)) {
        throw new Error("Legacy shared occurrences disagree on the final vertex coordinate.");
      }
      operations.set(vertex.vertexId, candidate);
    });
  }
  return {
    pair,
    digest: sha256(stableJson(pair.map((dguid) => proposedByDguid.get(dguid)?.geometry))),
    operations: [...operations.values()].sort((a, b) => a.vertex_id.localeCompare(b.vertex_id)),
    validationReport: { migratedFromLegacy: true, legacyValidationReport: legacyRevision.validation_report ?? {} },
  };
}

async function loadSubmissions(from) {
  let query = supabase.from("submissions")
    .select("id,type,user_id,dguid,neighboring_dguid,created_at")
    .in("type", ["objection", "counter_proposal"])
    .order("id", { ascending: true })
    .range(from, from + batchSize - 1);
  if (onlySubmissionId) query = query.eq("id", onlySubmissionId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

const report = { mode: apply ? "apply" : "dry-run", releaseId: release.manifest.releaseId, ready: 0, manualReview: 0, failed: 0, operations: 0, rows: [] };
let offset = 0;
while (true) {
  const submissions = await loadSubmissions(offset);
  if (!submissions.length) break;
  const cpIds = submissions.filter(({ type }) => type === "counter_proposal").map(({ id }) => id);
  let legacyBySubmission = new Map();
  if (cpIds.length) {
    const { data, error } = await supabase.from("counter_proposal_revisions").select("*").in("submission_id", cpIds).order("revision_number", { ascending: false });
    if (error) throw error;
    for (const revision of data ?? []) {
      if (!legacyBySubmission.has(revision.submission_id)) legacyBySubmission.set(revision.submission_id, revision);
    }
  }
  for (const submission of submissions) {
    let converted;
    let state = "ready";
    let migrationError = null;
    try {
      const pair = canonicalPair(submission.dguid, submission.neighboring_dguid);
      if (submission.type === "objection") {
        if (!release.sharedArcs[pair.join("|")]) throw new Error("Objection pair is not adjacent in this release.");
        converted = {
          pair,
          digest: sha256(`${release.dguids[pair[0]].sha256}|${release.dguids[pair[1]].sha256}`),
          operations: [],
          validationReport: { migratedFromLegacy: true, operationCount: 0 },
        };
      } else {
        const legacy = legacyBySubmission.get(submission.id);
        if (!legacy) throw new Error("Counter-Proposal has no legacy revision.");
        converted = convertCounterProposal(submission, legacy);
        converted.legacyRevisionId = legacy.id;
      }
    } catch (error) {
      state = "manual_review";
      migrationError = redactError(error);
      const pair = canonicalPair(submission.dguid, submission.neighboring_dguid);
      converted = { pair, digest: sha256(`manual-review:${submission.id}`), operations: [], validationReport: { migratedFromLegacy: false } };
    }
    report[state === "ready" ? "ready" : "manualReview"] += 1;
    report.operations += converted.operations.length;
    report.rows.push({ submissionId: submission.id, state, operationCount: converted.operations.length, error: migrationError });
    if (apply) {
      const revisionPayload = {
        submission_id: submission.id,
        submission_type: submission.type,
        revision_number: 1,
        release_id: release.manifest.releaseId,
        base_revision: release.manifest.geometryRevision,
        primary_dguid: converted.pair[0],
        secondary_dguid: converted.pair[1],
        geometry_digest: converted.digest,
        validation_report: converted.validationReport,
        migration_state: state,
        migration_error: migrationError,
        legacy_revision_id: converted.legacyRevisionId ?? null,
        created_by: submission.user_id,
        created_at: submission.created_at,
      };
      const { data: revision, error: revisionError } = await supabase.from("submission_geometry_revisions").upsert(revisionPayload, { onConflict: "submission_id,revision_number" }).select("id").single();
      if (revisionError) throw revisionError;
      if (converted.operations.length) {
        const rows = converted.operations.map((operation, operation_index) => ({ revision_id: revision.id, operation_index, ...operation }));
        const { error: operationError } = await supabase.from("submission_geometry_operations").upsert(rows, { onConflict: "revision_id,vertex_id" });
        if (operationError) throw operationError;
      }
      const { error: submissionError } = await supabase.from("submissions").update({ release_id: release.manifest.releaseId }).eq("id", submission.id);
      if (submissionError) throw submissionError;
    }
  }
  offset += submissions.length;
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(checkpointPath, `${JSON.stringify({ offset, releaseId: release.manifest.releaseId, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  if (onlySubmissionId || submissions.length < batchSize) break;
}
console.log(JSON.stringify(report, null, 2));
if (report.manualReview || report.failed) process.exitCode = 2;
