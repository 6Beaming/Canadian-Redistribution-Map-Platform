import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

const baselineSql = fs.readFileSync(
  new URL("../supabase/migrations/20260719000000_baseline_application_schema.sql", import.meta.url),
  "utf8",
);
const geometrySql = fs.readFileSync(
  new URL("../supabase/migrations/20260901090000_map_release_geometry_expand.sql", import.meta.url),
  "utf8",
);

test("fresh databases reconstruct the pre-migration application baseline", () => {
  for (const table of [
    "profiles",
    "pending_invites",
    "dissemination_areas",
    "map_proposals",
    "submissions",
    "comment_tags",
  ]) {
    assert.match(baselineSql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(baselineSql, /constraint submissions_user_id_fkey/);
  assert.match(baselineSql, /references auth\.users \(id\)/);
  assert.doesNotMatch(baselineSql, /insert into|drop table|drop column/);
});
const archiveSql = fs.readFileSync(
  new URL("../supabase/migrations/20260901091000_archive_v2_expand.sql", import.meta.url),
  "utf8",
);
const inventorySql = fs.readFileSync(
  new URL("../supabase/migrations/20260901093000_supabase_contract_inventory.sql", import.meta.url),
  "utf8",
);
const cleanupSql = fs.readFileSync(
  new URL("../supabase/migrations/20260902163000_finalize_legacy_protocol_cleanup.sql", import.meta.url),
  "utf8",
);

test("map release expand migration freezes immutable identity and sparse operations", () => {
  for (const table of [
    "map_data_releases",
    "map_release_legacy_aliases",
    "submission_geometry_revisions",
    "submission_geometry_operations",
  ]) {
    assert.match(geometrySql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(geometrySql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(geometrySql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
  }
  assert.match(geometrySql, /operation_type = 'set_vertex'/);
  assert.match(geometrySql, /primary key \(revision_id, vertex_id\)/);
  assert.match(geometrySql, /release_id is immutable and already has a different identity/);
  assert.match(geometrySql, /where state = 'active'/);
  assert.doesNotMatch(geometrySql, /drop table public\.(counter_proposal_revisions|archive_tree)/);
});

test("archive v2 expand migration separates branch versions from global map revisions", () => {
  for (const table of [
    "archive_branches",
    "archive_versions",
    "archive_version_operations",
    "archive_vertex_state",
    "archive_map_revisions",
    "archive_map_da_heads",
  ]) {
    assert.match(archiveSql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(archiveSql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(archiveSql, /transition_kind in \('genesis', 'merge', 'revert', 'delete'\)/);
  assert.doesNotMatch(archiveSql, /transition_kind[^\n]+restore/);
  assert.match(archiveSql, /uses_base and geometry is null and display_geometry is null/);
  assert.match(archiveSql, /counter-proposal archive versions require exact\/display geometry and vertex state/);
  assert.doesNotMatch(archiveSql, /drop table public\.archive_tree/);
});

test("one-time migrations are dry-run by default and require explicit apply", () => {
  for (const relativePath of [
    "../scripts/one-time/register_map_release.mjs",
    "../scripts/one-time/backfill_submission_geometry_operations.mjs",
    "../scripts/one-time/migrate_archive_tree_v2.mjs",
  ]) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /process\.argv\.includes\("--apply"\)/);
  }
});

test("database cutover audit checks release identity, migration gaps, RLS, and browser grants", () => {
  const sql = fs.readFileSync(
    new URL("../supabase/migrations/20260901092000_refactor_verification_functions.sql", import.meta.url),
    "utf8",
  );
  for (const field of [
    "activeReleaseCount",
    "geometrySubmissionMissingRevision",
    "archiveSourceMissingGeometryRevision",
    "rlsDisabled",
    "browserTableGrants",
  ]) {
    assert.match(sql, new RegExp(field));
  }
  assert.match(sql, /grant execute on function public\.audit_final_refactor_database\(\) to service_role/);
  assert.match(sql, /revoke all on function public\.audit_final_refactor_database\(\) from public, anon, authenticated/);
});

test("legacy protocol cleanup migration drops dormant tables and rewrites list RPCs", () => {
  assert.doesNotMatch(cleanupSql, /join public\.dissemination_areas/i);
  assert.match(cleanupSql, /drop table if exists public\.archive_tree cascade/i);
  assert.match(cleanupSql, /drop table if exists public\.counter_proposal_revisions cascade/i);
  assert.match(cleanupSql, /drop table if exists public\.dissemination_areas cascade/i);
  assert.match(cleanupSql, /'legacyArchiveRows', 0/);
  assert.match(cleanupSql, /drop function if exists public\.merge_submission_into_archive\(uuid, uuid, jsonb\)/i);
});

test("post-cleanup fix removes archive_tree and dissemination_areas from live scope helpers", () => {
  const fixSql = fs.readFileSync(
    new URL("../supabase/migrations/20260902170000_fixup_post_cleanup_function_refs.sql", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(fixSql, /archive_tree/i);
  assert.doesNotMatch(fixSql, /dissemination_areas/i);
  assert.match(fixSql, /checkpoint0_submission_scope/i);
  assert.match(fixSql, /submission_matches_commissioner_pruid/i);
});

test("cleanup inventory is read-only, service-role-only, and paired with source reference auditing", () => {
  assert.match(inventorySql, /inventory_final_refactor_database/);
  assert.match(inventorySql, /pg_total_relation_size/);
  assert.match(inventorySql, /pg_get_constraintdef/);
  assert.match(inventorySql, /from pg_policies/);
  assert.match(inventorySql, /grant execute on function public\.inventory_final_refactor_database\(\)\s+to service_role/);
  assert.doesNotMatch(inventorySql, /drop table|drop column|delete from|truncate/);

  const auditScript = fs.readFileSync(
    new URL("../scripts/one-time/audit_supabase_contract.mjs", import.meta.url),
    "utf8",
  );
  assert.match(auditScript, /SOURCE_ROOTS = \["server", "src"\]/);
  assert.match(auditScript, /liveLegacyConsumers/);
  assert.match(auditScript, /cleanupReady/);
});
