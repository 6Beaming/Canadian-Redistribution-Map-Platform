import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  buildArchiveBranchKey,
  canonicalArchiveBranchDguids,
  geometryDigest,
  normalizeArchiveSubmissionType,
} from "../server/lib/archive/archiveMaterializer.js";
import fs from "node:fs";

test("buildArchiveBranchKey canonicalizes comment and pair branches", () => {
  assert.equal(
    buildArchiveBranchKey("feedback", "statscan-da-2021-r1", "2021S051260010118"),
    "comment:statscan-da-2021-r1:2021S051260010118",
  );
  assert.equal(
    buildArchiveBranchKey("objection", "statscan-da-2021-r1", "da-b", "da-a"),
    "objection:statscan-da-2021-r1:da-a|da-b",
  );
  assert.equal(
    buildArchiveBranchKey("counter-proposal", "statscan-da-2021-r1", "da-b", "da-a"),
    "counter-proposal:statscan-da-2021-r1:da-a|da-b",
  );
});

test("canonicalArchiveBranchDguids enforces archive_branches pair ordering", () => {
  assert.deepEqual(
    canonicalArchiveBranchDguids("objection", "da-b", "da-a"),
    { primaryDguid: "da-a", secondaryDguid: "da-b" },
  );
  assert.deepEqual(
    canonicalArchiveBranchDguids("counter-proposal", "2021S051260010119", "2021S051260010118"),
    { primaryDguid: "2021S051260010118", secondaryDguid: "2021S051260010119" },
  );
  assert.deepEqual(
    canonicalArchiveBranchDguids("feedback", "2021S051260010118", "2021S051260010119"),
    { primaryDguid: "2021S051260010118", secondaryDguid: null },
  );
});

test("buildArchiveBranchKey rejects incomplete pair identities", () => {
  assert.throws(
    () => buildArchiveBranchKey("objection", "statscan-da-2021-r1", "da-a", "da-a"),
    /two distinct DGUIDs/i,
  );
});

test("normalizeArchiveSubmissionType maps legacy aliases", () => {
  assert.equal(normalizeArchiveSubmissionType("feedback"), "comment");
  assert.equal(normalizeArchiveSubmissionType("counter-proposal"), "counter_proposal");
  assert.equal(normalizeArchiveSubmissionType("objection"), "objection");
});

test("geometryDigest is stable for equivalent object key order", () => {
  const left = geometryDigest({ b: 2, a: 1 });
  const right = geometryDigest({ a: 1, b: 2 });
  assert.equal(left, right);
  assert.match(left, /^sha256:[a-f0-9]{64}$/);
});

test("archive merge RPC avoids PL/pgSQL variable/column name collisions", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260901160000_fix_archive_merge_branch_key_ambiguity.sql",
    "utf8",
  );
  assert.match(migration, /v_branch_key text :=/);
  assert.match(migration, /v_submission_type text :=/);
  assert.match(migration, /\) values \(\s*v_branch_key, v_submission_type/);
  assert.match(migration, /on conflict \(branch_key\) do update/);
});

test("archive v2 transitions persist vertex state and preserve unrelated DA head geometry", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260901100000_archive_v2_transition_rpcs.sql",
    "utf8",
  );
  assert.match(migration, /insert into public\.archive_vertex_state/);
  assert.match(migration, /branchVertexSnapshot'->'vertices'/);
  assert.match(migration, /message = 'STALE_ARCHIVE_MAP'/);
  assert.match(migration, /else cp_payload->'headGeometry'->affected_dguid/);
  assert.doesNotMatch(migration, /where release_id = release_id/);
});

test("Delete Forever reinitializes sources and writes a Workspace system note", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260901100000_archive_v2_transition_rpcs.sql",
    "utf8",
  );
  assert.match(migration, /status = 'pending'/);
  assert.match(migration, /archive_branch_reinitialized/);
  assert.match(migration, /delete from public\.workspace_archive_requests/);
  assert.match(migration, /delete from public\.archive_source_revisions/);
  assert.match(migration, /delete from public\.archive_branches/);
});
