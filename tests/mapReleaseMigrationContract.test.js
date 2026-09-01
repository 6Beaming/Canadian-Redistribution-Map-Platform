import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

const geometrySql = fs.readFileSync(
  new URL("../supabase/migrations/20260901090000_map_release_geometry_expand.sql", import.meta.url),
  "utf8",
);
const archiveSql = fs.readFileSync(
  new URL("../supabase/migrations/20260901091000_archive_v2_expand.sql", import.meta.url),
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
