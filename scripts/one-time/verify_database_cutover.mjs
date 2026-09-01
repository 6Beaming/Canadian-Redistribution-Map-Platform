#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadLocalRelease, requireAdminClient } from "../reusable/map_release_db.mjs";

const outputFlag = process.argv.indexOf("--output");
const outputPath = path.resolve(outputFlag >= 0 ? process.argv[outputFlag + 1] : "local/database-cutover-audit.json");
const release = loadLocalRelease();
const supabase = requireAdminClient();
const { data: audit, error } = await supabase.rpc("audit_final_refactor_database");
if (error) throw new Error(`Database cutover audit failed: ${error.message}`);

const expected = release.manifest;
const active = audit?.activeRelease ?? {};
const mismatches = [
  ["release_id", expected.releaseId],
  ["geometry_revision", expected.geometryRevision],
  ["manifest_sha256", expected.manifestSha256],
  ["topology_revision", expected.topologyRevision],
  ["normalization_version", expected.normalizationVersion],
  ["vertex_schema_version", expected.vertexSchemaVersion],
  ["lod_schema_version", expected.lodSchemaVersion],
].filter(([field, value]) => active[field] !== value)
  .map(([field, value]) => ({ field, expected: value, actual: active[field] ?? null }));

const blocking = {
  activeReleaseCount: Number(audit?.activeReleaseCount ?? 0) !== 1,
  releaseIdentity: mismatches.length > 0,
  geometryDisposition: Object.entries(audit?.geometryDisposition ?? {})
    .some(([state, count]) => state !== "ready" && Number(count) > 0),
  geometrySubmissionMissingRelease: Number(audit?.geometrySubmissionMissingRelease ?? 0) > 0,
  geometrySubmissionMissingRevision: Number(audit?.geometrySubmissionMissingRevision ?? 0) > 0,
  archiveSourceMissingGeometryRevision: Number(audit?.archiveSourceMissingGeometryRevision ?? 0) > 0,
  archiveMigration: Number(audit?.legacyArchiveRows ?? 0) !== Number(audit?.archiveV2Versions ?? 0),
  rlsDisabled: (audit?.rlsDisabled ?? []).length > 0,
  browserTableGrants: (audit?.browserTableGrants ?? []).length > 0,
};
const report = {
  schemaVersion: "1.0",
  ok: Object.values(blocking).every((value) => !value),
  checkedAt: new Date().toISOString(),
  releaseId: expected.releaseId,
  mismatches,
  blocking,
  audit,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 2;

