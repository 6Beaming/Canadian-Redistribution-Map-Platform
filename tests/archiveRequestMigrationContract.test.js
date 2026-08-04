import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

test("Archive Request migration repairs only submissions without an active request", () => {
  const sql = fs.readFileSync(
    "supabase/migrations/20260804120000_repair_orphan_archive_requests.sql",
    "utf8",
  );

  assert.match(sql, /where submission\.status = 'archive-request'/i);
  assert.match(sql, /not exists[\s\S]*request\.submission_id = submission\.id/i);
  assert.match(sql, /request\.state in \('open', 'approved'\)/i);
  assert.match(sql, /status = 'accepted'/i);
  assert.match(sql, /resource_version = greatest\(coalesce\(submission\.resource_version, 1\), 1\) \+ 1/i);
  assert.match(sql, /active_claim_pruid = null/i);
  assert.match(sql, /active_claim_actor_id = null/i);
});

test("Archived Tree deletion recovers legacy scope and removes request dependencies first", () => {
  const sql = fs.readFileSync(
    "supabase/migrations/20260804130000_fix_archive_branch_delete.sql",
    "utf8",
  );

  assert.match(
    sql,
    /checkpoint0_submission_scope[\s\S]*archive_source_revisions[\s\S]*scope_pruids/i,
  );
  assert.match(sql, /operating_pruid[\s\S]*workspace_archive_requests/i);
  assert.match(sql, /active_claim_pruid/i);
  assert.match(sql, /\^\(\[0-9\]\{2\}\)\[0-9\]\{6\}\$/i);
  assert.match(
    sql,
    /foreach submission_id in array submission_ids[\s\S]*checkpoint0_submission_scope\(submission_id\)/i,
  );

  const requestDelete = sql.indexOf("delete from public.workspace_archive_requests");
  const sourceDelete = sql.indexOf("delete from public.archive_source_revisions");
  const archiveDelete = sql.indexOf("delete from public.archive_tree");
  const submissionDelete = sql.indexOf("delete from public.submissions");

  assert.ok(requestDelete >= 0);
  assert.ok(requestDelete < sourceDelete);
  assert.ok(sourceDelete < archiveDelete);
  assert.ok(archiveDelete < submissionDelete);
});

test("Archived Tree deletion skips scope backfill for orphaned submission IDs", () => {
  const sql = fs.readFileSync(
    "supabase/migrations/20260804140000_fix_orphan_archive_branch_delete.sql",
    "utf8",
  );

  assert.match(
    sql,
    /for submission_id in[\s\S]*from public\.submissions submission[\s\S]*where submission\.id = any\(submission_ids\)[\s\S]*checkpoint0_submission_scope\(submission_id\)/i,
  );
  assert.doesNotMatch(sql, /foreach submission_id in array submission_ids/i);

  const requestDelete = sql.indexOf("delete from public.workspace_archive_requests");
  const sourceDelete = sql.indexOf("delete from public.archive_source_revisions");
  const archiveDelete = sql.indexOf("delete from public.archive_tree");
  const submissionDelete = sql.indexOf("delete from public.submissions");

  assert.ok(requestDelete >= 0);
  assert.ok(requestDelete < sourceDelete);
  assert.ok(sourceDelete < archiveDelete);
  assert.ok(archiveDelete < submissionDelete);
});
