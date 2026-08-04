import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

const migration = fs.readFileSync(
  "supabase/migrations/20260804100000_checkpoint0_realtime_adapters.sql",
  "utf8",
);

test("Checkpoint 0 adapters write outbox and deliveries in mutation transactions", () => {
  assert.match(migration, /insert into public\.realtime_outbox/i);
  assert.match(migration, /insert into public\.realtime_scope_deliveries/i);
  assert.match(migration, /after update of status on public\.submissions/i);
  assert.match(migration, /after insert or update or delete on public\.workspace_comments/i);
  assert.match(migration, /after insert or update or delete on public\.workspace_labels/i);
  assert.match(migration, /before delete on public\.submissions/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
});

test("Checkpoint 0 adapters cover CP2 submission creates and only its supported delete", () => {
  assert.match(migration, /new\.type in \('feedback', 'objection'\)/i);
  assert.match(migration, /after insert on public\.counter_proposal_revisions/i);
  assert.match(migration, /if old\.type = 'feedback'/i);
});

test("Checkpoint 0 projection hints contain identifiers, not protected record bodies", () => {
  assert.match(migration, /jsonb_build_object\([\s\S]*'entity'[\s\S]*'entityId'/i);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]*'content'/i);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]*'geometry'/i);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]*'email'/i);
});
