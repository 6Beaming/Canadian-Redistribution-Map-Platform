import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

const migration = fs.readFileSync(
  "supabase/migrations/20260804100000_checkpoint0_realtime_adapters.sql",
  "utf8",
);
const insertOperationFix = fs.readFileSync(
  "supabase/migrations/20260804110000_fix_realtime_insert_operations.sql",
  "utf8",
);
const cleanupMigration = fs.readFileSync(
  "supabase/migrations/20260902163000_finalize_legacy_protocol_cleanup.sql",
  "utf8",
);

test("Real time adapters write outbox and deliveries in mutation transactions", () => {
  assert.match(migration, /insert into public\.realtime_outbox/i);
  assert.match(migration, /insert into public\.realtime_scope_deliveries/i);
  assert.match(migration, /after update of status on public\.submissions/i);
  assert.match(migration, /after insert or update or delete on public\.workspace_comments/i);
  assert.match(migration, /after insert or update or delete on public\.workspace_labels/i);
  assert.match(migration, /before delete on public\.submissions/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
});

test("Real time adapters cover CP2 submission creates and only its supported delete", () => {
  assert.match(migration, /new\.type in \('feedback', 'objection'\)/i);
  assert.match(migration, /after insert on public\.counter_proposal_revisions/i);
  assert.match(migration, /if old\.type = 'feedback'/i);
});

test("Counter-proposal realtime events follow geometry revisions after legacy cleanup", () => {
  assert.match(cleanupMigration, /after insert on public\.submission_geometry_revisions/i);
  assert.match(cleanupMigration, /submission_type = 'counter_proposal'/i);
  assert.match(cleanupMigration, /checkpoint0_counter_proposal_realtime\(\)/i);
});

test("Real time projection hints contain identifiers, not protected record bodies", () => {
  assert.match(migration, /jsonb_build_object\([\s\S]*'entity'[\s\S]*'entityId'/i);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]*'content'/i);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]*'geometry'/i);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]*'email'/i);
});

test("Real time maps PostgreSQL INSERT triggers to realtime create operations", () => {
  assert.match(insertOperationFix, /checkpoint0_workspace_comment_realtime\(\)[\s\S]*when 'INSERT' then 'create'/i);
  assert.match(insertOperationFix, /checkpoint0_workspace_label_realtime\(\)[\s\S]*when 'INSERT' then 'create'/i);
});
