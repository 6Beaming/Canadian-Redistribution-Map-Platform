#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { requireAdminClient } from "../reusable/map_release_db.mjs";

const outputFlag = process.argv.indexOf("--output");
const outputPath = path.resolve(
  outputFlag >= 0 ? process.argv[outputFlag + 1] : "local/supabase-contract-audit.json",
);
const SOURCE_ROOTS = ["server", "src"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const LEGACY_CONTRACTS = [
  { name: "counter_proposal_revisions", kind: "table" },
  { name: "archive_tree", kind: "table" },
  { name: "dissemination_areas", kind: "table" },
  { name: "merge_submission_into_archive", kind: "routine" },
  { name: "revert_archive_branch", kind: "routine" },
  { name: "delete_archive_branch", kind: "routine" },
];
const KEEP_TABLES = [
  "profiles",
  "submissions",
  "workspace_comments",
  "workspace_labels",
  "workspace_label_catalog",
  "workspace_archive_requests",
  "workspace_archive_request_votes",
  "submission_scope_pruids",
  "archive_source_revisions",
  "realtime_outbox",
  "realtime_scope_deliveries",
  "map_data_releases",
  "map_release_legacy_aliases",
  "submission_geometry_revisions",
  "submission_geometry_operations",
  "archive_branches",
  "archive_versions",
  "archive_version_operations",
  "archive_vertex_state",
  "archive_map_revisions",
  "archive_map_da_heads",
];

function walk(root, files = []) {
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

const sources = SOURCE_ROOTS.flatMap((root) => walk(path.resolve(root)));
const sourceText = sources.map((filePath) => ({
  filePath,
  relativePath: path.relative(process.cwd(), filePath).replaceAll(path.sep, "/"),
  text: fs.readFileSync(filePath, "utf8"),
}));

function referencesFor(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`\\b${escaped}\\b`);
  return sourceText.flatMap(({ relativePath, text }) => {
    const lines = text.split(/\r?\n/u);
    return lines.flatMap((line, index) => expression.test(line)
      ? [{ file: relativePath, line: index + 1 }]
      : []);
  });
}

const supabase = requireAdminClient();
const [{ data: inventory, error: inventoryError }, { data: cutover, error: cutoverError }] = await Promise.all([
  supabase.rpc("inventory_final_refactor_database"),
  supabase.rpc("audit_final_refactor_database"),
]);
if (inventoryError) throw new Error(`Database inventory failed: ${inventoryError.message}`);
if (cutoverError) throw new Error(`Database cutover audit failed: ${cutoverError.message}`);

const relationNames = new Set((inventory?.relations ?? []).map(({ name }) => name));
const routineNames = new Set((inventory?.routines ?? []).map(({ name }) => name));
const legacy = LEGACY_CONTRACTS.map((contract) => {
  const references = referencesFor(contract.name);
  const exists = contract.kind === "table"
    ? relationNames.has(contract.name)
    : routineNames.has(contract.name);
  return {
    ...contract,
    exists,
    disposition: !exists ? "absent" : references.length ? "migrate" : "drop-candidate",
    references,
  };
});
const missingKeepTables = KEEP_TABLES.filter((name) => !relationNames.has(name));
const blockingCutover = {
  activeReleaseCount: Number(cutover?.activeReleaseCount ?? 0) !== 1,
  nonReadyGeometry: Object.entries(cutover?.geometryDisposition ?? {})
    .some(([state, count]) => state !== "ready" && Number(count) > 0),
  missingSubmissionRelease: Number(cutover?.geometrySubmissionMissingRelease ?? 0) > 0,
  missingSubmissionRevision: Number(cutover?.geometrySubmissionMissingRevision ?? 0) > 0,
  missingArchiveGeometryRevision: Number(cutover?.archiveSourceMissingGeometryRevision ?? 0) > 0,
  archiveCountMismatch: Number(cutover?.legacyArchiveRows ?? 0) !== Number(cutover?.archiveV2Versions ?? 0),
  missingKeepTables: missingKeepTables.length > 0,
  liveLegacyConsumers: legacy.some(({ disposition }) => disposition === "migrate"),
};
const report = {
  schemaVersion: "1.0",
  checkedAt: new Date().toISOString(),
  cleanupReady: Object.values(blockingCutover).every((blocked) => !blocked),
  blockingCutover,
  keep: KEEP_TABLES.map((name) => ({ name, exists: relationNames.has(name) })),
  legacy,
  database: inventory,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.cleanupReady) process.exitCode = 2;
