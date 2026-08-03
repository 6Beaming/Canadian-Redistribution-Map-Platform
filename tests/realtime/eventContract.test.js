import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "@jest/globals";
import {
  RealtimeEventContractError,
  compareResourceVersions,
  validateRealtimeEvent,
} from "../../server/realtime/eventContract.js";

function validEvent(overrides = {}) {
  return {
    aggregateId: "submission-1",
    committedAt: "2026-08-03T18:00:00.000Z",
    entity: "workspace.comment",
    entityId: "comment-1",
    eventId: crypto.randomUUID(),
    invalidate: ["workspace:submission:submission-1"],
    operation: "create",
    resourceVersion: 1,
    schemaVersion: 1,
    scope: { kind: "operating-province", pruids: ["46"] },
    sequence: 1,
    ...overrides,
  };
}

test("event contract accepts the frozen identifier-only envelope", () => {
  const event = validateRealtimeEvent(validEvent());
  assert.equal(event.schemaVersion, 1);
  assert.deepEqual(event.scope.pruids, ["46"]);
});

test.each([
  ["comment body", { comment: "private text" }],
  ["GeoJSON", { geometry: { type: "FeatureCollection", features: [] } }],
  ["profile", { profile: { email: "private@example.com" } }],
  ["assignees", { assignees: ["profile-1"] }],
  ["votes", { votes: { "profile-1": true } }],
  ["export", { exportBody: "private export" }],
])("event contract rejects protected %s payloads", (_label, extra) => {
  assert.throws(
    () => validateRealtimeEvent({ ...validEvent(), ...extra }),
    RealtimeEventContractError,
  );
});

test("event contract rejects unknown entities, invalid schemas, and cross-scope delivery", () => {
  assert.throws(() => validateRealtimeEvent(validEvent({ entity: "workspace.secret" })));
  assert.throws(() => validateRealtimeEvent(validEvent({ schemaVersion: 2 })));
  assert.throws(() => validateRealtimeEvent(validEvent({
    scope: { kind: "operating-province", pruids: ["46", "47"] },
  })));
});

test("resource versions compare numeric and timestamp versions deterministically", () => {
  assert.equal(compareResourceVersions("10", "2"), 1);
  assert.equal(compareResourceVersions("2026-08-03T19:00:00Z", "2026-08-03T18:00:00Z"), 1);
  assert.equal(compareResourceVersions("same", "same"), 0);
});

