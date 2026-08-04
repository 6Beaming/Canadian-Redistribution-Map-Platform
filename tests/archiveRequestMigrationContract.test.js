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
