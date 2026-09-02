#!/usr/bin/env node
import "dotenv/config";
import { requireAdminClient } from "../reusable/map_release_db.mjs";

const apply = process.argv.includes("--apply");
const supabase = requireAdminClient();

const { data: legacyRows, error: legacyError } = await supabase
  .from("archive_tree")
  .select("id,submission_id,branch_key,version_number")
  .order("merged_at", { ascending: true });
if (legacyError) throw legacyError;

const submissionIds = (legacyRows ?? []).map((row) => row.submission_id).filter(Boolean);
const covered = new Set();
if (submissionIds.length) {
  const { data: versions, error: versionError } = await supabase
    .from("archive_versions")
    .select("source_submission_id")
    .in("source_submission_id", submissionIds);
  if (versionError) throw versionError;
  for (const version of versions ?? []) {
    if (version.source_submission_id) covered.add(version.source_submission_id);
  }
}

const report = {
  mode: apply ? "apply" : "dry-run",
  legacyRows: legacyRows?.length ?? 0,
  purgeable: [],
  blocked: [],
};

for (const row of legacyRows ?? []) {
  if (covered.has(row.submission_id)) {
    report.purgeable.push(row);
  } else {
    report.blocked.push({
      ...row,
      reason: "No archive_versions row references this submission_id.",
    });
  }
}

if (apply && report.purgeable.length) {
  const ids = report.purgeable.map((row) => row.id);
  const { error } = await supabase.from("archive_tree").delete().in("id", ids);
  if (error) throw error;
}

console.log(JSON.stringify(report, null, 2));
if (report.blocked.length) process.exitCode = 2;
