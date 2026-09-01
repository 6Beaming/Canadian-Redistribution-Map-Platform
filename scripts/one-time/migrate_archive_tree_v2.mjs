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
const allowUnresolved = process.argv.includes("--allow-unresolved");
const release = loadLocalRelease();
const supabase = requireAdminClient();

function normalizeType(value) {
  const type = String(value ?? "feedback").toLowerCase().replaceAll("-", "_");
  if (["feedback", "comment", "comments"].includes(type)) return "comment";
  if (type === "objection") return "objection";
  if (["counterproposal", "counter_proposal"].includes(type)) return "counter_proposal";
  throw new Error(`Unsupported archived submission type: ${type}.`);
}

function branchIdentity(snapshot) {
  const type = normalizeType(snapshot.type);
  const primary = String(snapshot.dguid ?? "").trim();
  if (!primary) throw new Error("Archived snapshot is missing its primary DGUID.");
  if (type === "comment") {
    return { type, primary, secondary: null, key: `comment:${release.manifest.releaseId}:${primary}` };
  }
  const [first, second] = canonicalPair(primary, snapshot.neighboring_dguid);
  return { type, primary: first, secondary: second, key: `${type.replace("_", "-")}:${release.manifest.releaseId}:${first}|${second}` };
}

function projection(row, identity) {
  const snapshot = row.submission_snapshot ?? {};
  return {
    source_submission_id: row.submission_id,
    type: identity.type,
    title: snapshot.title ?? null,
    comment: snapshot.comment ?? null,
    author: { id: snapshot.user_id ?? null },
    submitted_at: snapshot.created_at ?? null,
    merged_at: row.merged_at,
    primaryDguid: identity.primary,
    secondaryDguid: identity.secondary,
    releaseId: release.manifest.releaseId,
  };
}

const { data: legacyRows, error: legacyError } = await supabase
  .from("archive_tree")
  .select("*")
  .order("merged_at", { ascending: true });
if (legacyError) throw legacyError;

const submissionIds = (legacyRows ?? []).map(({ submission_id }) => submission_id);
const scopeBySubmission = new Map();
if (submissionIds.length) {
  const { data, error } = await supabase
    .from("submission_scope_pruids")
    .select("submission_id,pruid")
    .in("submission_id", submissionIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!scopeBySubmission.has(row.submission_id)) scopeBySubmission.set(row.submission_id, []);
    scopeBySubmission.get(row.submission_id).push(row.pruid);
  }
}

const geometryBySubmission = new Map();
if (submissionIds.length) {
  const { data, error } = await supabase
    .from("submission_geometry_revisions")
    .select("id,submission_id,migration_state,geometry_digest")
    .in("submission_id", submissionIds)
    .order("revision_number", { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) {
    if (!geometryBySubmission.has(row.submission_id)) geometryBySubmission.set(row.submission_id, row);
  }
}

const report = {
  mode: apply ? "apply" : "dry-run",
  releaseId: release.manifest.releaseId,
  legacyRows: legacyRows?.length ?? 0,
  branches: 0,
  versions: 0,
  unresolved: [],
  warnings: [],
};
const grouped = new Map();
for (const row of legacyRows ?? []) {
  try {
    const identity = branchIdentity(row.submission_snapshot ?? {});
    if (!grouped.has(identity.key)) grouped.set(identity.key, { identity, rows: [] });
    grouped.get(identity.key).rows.push(row);
  } catch (error) {
    report.unresolved.push({ legacyArchiveId: row.id, submissionId: row.submission_id, reason: redactError(error) });
  }
}
report.branches = grouped.size;

for (const { identity, rows } of grouped.values()) {
  const firstRow = rows[0];
  let scopePruids = [...new Set(rows.flatMap((row) => scopeBySubmission.get(row.submission_id) ?? []))].sort();
  if (!scopePruids.length) {
    scopePruids = [...new Set([identity.primary, identity.secondary]
      .filter(Boolean)
      .map((dguid) => release.dguids[dguid]?.pruid)
      .filter(Boolean))].sort();
  }
  if (!scopePruids.length || scopePruids.length > 2) {
    report.unresolved.push({ branchKey: identity.key, reason: "Unable to prove a one-/two-PRUID branch scope." });
    continue;
  }

  let branch = { id: `dry:${identity.key}` };
  if (apply) {
    const { data, error } = await supabase.from("archive_branches").upsert({
      branch_key: identity.key,
      submission_type: identity.type,
      release_id: release.manifest.releaseId,
      primary_dguid: identity.primary,
      secondary_dguid: identity.secondary,
      scope_pruids: scopePruids,
      updated_at: rows.at(-1)?.merged_at ?? new Date().toISOString(),
      created_at: firstRow.merged_at,
    }, { onConflict: "branch_key" }).select("id").single();
    if (error) throw error;
    branch = data;
  }

  let headVersion = null;
  for (const row of rows.sort((a, b) => Number(a.version_number) - Number(b.version_number))) {
    const geometryRevision = geometryBySubmission.get(row.submission_id);
    let resultGeometry = null;
    let geometryDigest = null;
    let branchVertexSnapshot = null;
    if (identity.type === "counter_proposal") {
      if (geometryRevision?.migration_state !== "ready") {
        report.unresolved.push({ branchKey: identity.key, submissionId: row.submission_id, reason: "Counter-Proposal compact geometry revision is not ready." });
        continue;
      }
      resultGeometry = row.submission_snapshot?.geometry ?? null;
      if (!resultGeometry) {
        report.unresolved.push({ branchKey: identity.key, submissionId: row.submission_id, reason: "Legacy Counter-Proposal archive snapshot has no materializable geometry." });
        continue;
      }
      geometryDigest = sha256(stableJson(resultGeometry));
      branchVertexSnapshot = { migrationSourceGeometryRevisionId: geometryRevision.id };
    } else if (!geometryRevision && identity.type === "objection") {
      report.unresolved.push({ branchKey: identity.key, submissionId: row.submission_id, reason: "Objection compact geometry descriptor is not ready." });
      continue;
    }

    const versionPayload = {
      branch_id: branch.id,
      version_number: Number(row.version_number),
      version_kind: "migration",
      source_submission_id: row.submission_id,
      source_geometry_revision_id: geometryRevision?.id ?? null,
      submission_projection: projection(row, identity),
      branch_vertex_snapshot: branchVertexSnapshot,
      result_geometry: resultGeometry,
      display_geometry: resultGeometry,
      geometry_digest: geometryDigest,
      validation_report: {
        migratedFromLegacyArchiveId: row.id,
        exactGeometryRequiresReplay: identity.type === "counter_proposal",
      },
      closing_comment: row.closing_comment,
      merged_by: row.merged_by,
      merged_at: row.merged_at,
    };
    if (apply) {
      const { data: existing, error: existingError } = await supabase
        .from("archive_versions")
        .select("id,version_number")
        .eq("branch_id", branch.id)
        .eq("source_submission_id", row.submission_id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        headVersion = existing;
      } else {
        const { data, error } = await supabase.from("archive_versions").insert(versionPayload).select("id,version_number").single();
        if (error) throw error;
        headVersion = data;
      }
    } else {
      headVersion = { id: `dry:${row.id}`, version_number: versionPayload.version_number };
    }
    report.versions += 1;
  }
  const legacyHead = rows.find(({ is_latest }) => is_latest);
  if (legacyHead && headVersion && legacyHead.submission_id !== rows.at(-1)?.submission_id) {
    report.warnings.push({ branchKey: identity.key, reason: "Legacy branch points to an older reverted row; create an explicit v2 revert after geometry replay." });
  }
  if (apply && headVersion) {
    const { error } = await supabase.from("archive_branches").update({
      head_version_id: headVersion.id,
      head_version_number: headVersion.version_number,
      resource_version: rows.length,
    }).eq("id", branch.id);
    if (error) throw error;
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.unresolved.length && !allowUnresolved) {
  console.error("Archive migration is incomplete; resolve every row before cutover. --allow-unresolved only permits audit continuation.");
  process.exitCode = 2;
}

