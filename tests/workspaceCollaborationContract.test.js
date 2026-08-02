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

test("local custom-label migration retires the global catalog runtime path", () => {
  const sql = fs.readFileSync(
    "supabase/migrations/20260802130000_local_workspace_custom_labels.sql",
    "utf8",
  );
  const router = fs.readFileSync("server/routes/workspaceCollaboration.js", "utf8");

  assert.match(sql, /add column if not exists is_selected/i);
  assert.match(sql, /set_submission_workspace_labels/i);
  assert.match(sql, /Custom label does not belong to this submission/i);
  assert.match(sql, /Deprecated after 20260802130000/i);
  assert.doesNotMatch(router, /from\("workspace_label_catalog"\)/);
  assert.match(router, /from\("workspace_labels"\)[\s\S]*\.eq\("submission_id", submissionId\)/);
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
