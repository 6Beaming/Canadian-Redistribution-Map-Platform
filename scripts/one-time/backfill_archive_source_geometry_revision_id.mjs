#!/usr/bin/env node
import "dotenv/config";
import { redactError, requireAdminClient } from "../reusable/map_release_db.mjs";

const apply = process.argv.includes("--apply");
const supabase = requireAdminClient();

function normalizeSubmissionType(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
}

const { data: missingRows, error: missingError } = await supabase
  .from("archive_source_revisions")
  .select("id,submission_id,submission_type,primary_dguid,secondary_dguid,created_at")
  .in("submission_type", ["objection", "counter_proposal", "counter-proposal"])
  .is("source_geometry_revision_id", null);
if (missingError) throw missingError;

const submissionIds = [...new Set((missingRows ?? []).map((row) => row.submission_id).filter(Boolean))];
const revisionBySubmission = new Map();
if (submissionIds.length) {
  const { data, error } = await supabase
    .from("submission_geometry_revisions")
    .select("id,submission_id,revision_number,migration_state")
    .in("submission_id", submissionIds)
    .order("revision_number", { ascending: false });
  if (error) throw error;
  for (const revision of data ?? []) {
    if (!revisionBySubmission.has(revision.submission_id)) {
      revisionBySubmission.set(revision.submission_id, revision);
    }
  }
}

const report = {
  mode: apply ? "apply" : "dry-run",
  missingRows: missingRows?.length ?? 0,
  resolved: 0,
  unresolved: [],
  updates: [],
};

for (const row of missingRows ?? []) {
  const revision = revisionBySubmission.get(row.submission_id);
  if (!revision?.id) {
    report.unresolved.push({
      sourceRevisionId: row.id,
      submissionId: row.submission_id,
      reason: "No submission_geometry_revisions row exists for this submission.",
    });
    continue;
  }
  if (revision.migration_state !== "ready") {
    report.unresolved.push({
      sourceRevisionId: row.id,
      submissionId: row.submission_id,
      geometryRevisionId: revision.id,
      reason: `Geometry revision is ${revision.migration_state}, not ready.`,
    });
    continue;
  }
  report.resolved += 1;
  report.updates.push({
    sourceRevisionId: row.id,
    submissionId: row.submission_id,
    geometryRevisionId: revision.id,
  });
  if (apply) {
    const { error } = await supabase
      .from("archive_source_revisions")
      .update({ source_geometry_revision_id: revision.id })
      .eq("id", row.id);
    if (error) throw error;
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.unresolved.length) process.exitCode = 2;
