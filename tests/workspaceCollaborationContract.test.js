import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

test("Workspace collaboration migration keeps label identity stable and catalog-authoritative", () => {
  const sql = fs.readFileSync("supabase/migrations/20260802090000_reliable_workspace_collaboration.sql", "utf8");
  assert.match(sql, /Custom Label 1/);
  assert.match(sql, /Custom Label 2/);
  assert.match(sql, /Custom Label 3/);
  assert.match(sql, /on conflict \(submission_id, catalog_id\)/i);
  assert.match(sql, /catalog\.name, catalog\.color/i);
  assert.match(sql, /ranked_assignments/i);
  assert.match(sql, /workspace_label_catalog_assignment_sync/i);
  assert.match(sql, /where is_custom and name = 'Custom Cyan'/i);
  assert.doesNotMatch(sql, /select target_submission_id[^\n]*requested\.name/i);
});

test("Workspace browser service has no browser-authoritative shared-state storage", () => {
  const service = fs.readFileSync("src/services/workspaceApi.js", "utf8");
  const legacyRouter = fs.readFileSync("server/routes/workspace.js", "utf8");
  assert.equal(service.includes("crmp.workspace.v1"), false);
  assert.equal(service.includes("localStorage"), true, "the service should retain only the explicit documentation comment");
  assert.equal((service.match(/localStorage/g) ?? []).length, 1);
  assert.doesNotMatch(legacyRouter, /router\.post\("\/labels\/:submissionId"/);
  assert.doesNotMatch(legacyRouter, /router\.(get|post)\("\/comments/);
  assert.doesNotMatch(legacyRouter, /router\.(get|post)\("\/label-catalog/);
});
