#!/usr/bin/env node
import "dotenv/config";
import {
  canonicalPair,
  loadLocalRelease,
  redactError,
  requireAdminClient,
  sha256,
  stableJson,
} from "../reusable/map_release_db.mjs";

const apply = process.argv.includes("--apply");
const onlySubmissionId = process.argv.includes("--submission-id")
  ? process.argv[process.argv.indexOf("--submission-id") + 1]
  : null;
const release = loadLocalRelease();
const supabase = requireAdminClient();

function featuresByDguid(collection) {
  return new Map((collection?.features ?? []).map((feature) => [
    String(feature?.properties?.DGUID ?? feature?.id ?? "").trim(),
    feature,
  ]));
}

function proposedDigestForSubmission(submissionType, pair, proposedGeometry) {
  if (submissionType === "objection") {
    return sha256(`${release.dguids[pair[0]].sha256}|${release.dguids[pair[1]].sha256}`);
  }
  return sha256(stableJson(pair.map((dguid) => featuresByDguid(proposedGeometry).get(dguid)?.geometry)));
}

async function loadProposedGeometry(submission, legacyRevision) {
  if (legacyRevision?.proposed_geometry?.features?.length) {
    return legacyRevision.proposed_geometry;
  }
  if (submission?.geometry?.features?.length) {
    return submission.geometry;
  }
  const { data: archiveRow, error } = await supabase
    .from("archive_tree")
    .select("submission_snapshot")
    .eq("submission_id", submission.id)
    .order("merged_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return archiveRow?.submission_snapshot?.geometry ?? null;
}

let query = supabase
  .from("submission_geometry_revisions")
  .select("id,submission_id,submission_type,primary_dguid,secondary_dguid,revision_number,migration_state,migration_error,legacy_revision_id")
  .eq("migration_state", "manual_review");
if (onlySubmissionId) query = query.eq("submission_id", onlySubmissionId);
const { data: revisions, error: revisionError } = await query;
if (revisionError) throw revisionError;

const report = {
  mode: apply ? "apply" : "dry-run",
  releaseId: release.manifest.releaseId,
  candidates: revisions?.length ?? 0,
  resolved: 0,
  unresolved: [],
};

for (const revision of revisions ?? []) {
  try {
    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .select("id,type,user_id,dguid,neighboring_dguid,geometry,created_at")
      .eq("id", revision.submission_id)
      .single();
    if (submissionError) throw submissionError;

    const pair = canonicalPair(revision.primary_dguid ?? submission.dguid, revision.secondary_dguid ?? submission.neighboring_dguid);
    let legacyRevision = null;
    if (submission.type === "counter_proposal") {
      const { data, error } = await supabase
        .from("counter_proposal_revisions")
        .select("id,proposed_geometry,validation_report")
        .eq("submission_id", submission.id)
        .order("revision_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      legacyRevision = data;
    }

    const proposedGeometry = await loadProposedGeometry(submission, legacyRevision);
    if (!proposedGeometry?.features?.length && submission.type === "counter_proposal") {
      throw new Error("Unable to locate proposed geometry for manual-review Counter-Proposal.");
    }

    const digest = proposedDigestForSubmission(submission.type, pair, proposedGeometry);
    const updatePayload = {
      migration_state: "ready",
      migration_error: null,
      geometry_digest: digest,
      legacy_revision_id: legacyRevision?.id ?? revision.legacy_revision_id ?? null,
      validation_report: {
        migratedFromLegacy: true,
        resolvedManualReview: true,
        releaseBaselineMismatch: true,
        legacyValidationReport: legacyRevision?.validation_report ?? {},
      },
    };

    report.resolved += 1;
    if (apply) {
      const { error } = await supabase
        .from("submission_geometry_revisions")
        .update(updatePayload)
        .eq("id", revision.id);
      if (error) throw error;
    }
  } catch (error) {
    report.unresolved.push({
      revisionId: revision.id,
      submissionId: revision.submission_id,
      reason: redactError(error),
    });
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.unresolved.length) process.exitCode = 2;
