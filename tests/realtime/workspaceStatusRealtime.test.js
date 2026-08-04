import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { SyntheticRealtimeEventStore } from "../../server/realtime/eventStore.js";
import { resolveRealtimeInvalidations } from "../../server/realtime/invalidationRegistry.js";
import {
  getWorkspaceReviewInvalidationTargets,
} from "../../src/lib/realtime/workspaceRealtime.js";

test("Issue 101 maps a status event to exact Workspace and table refetches", () => {
  const identity = {
    aggregateId: "submission-123",
    entity: "workspace.status",
    entityId: "submission-123",
  };
  const invalidations = resolveRealtimeInvalidations(identity);

  assert.deepEqual(invalidations, [
    "workspace:status:submission-123",
    "workspace:submission:submission-123",
    "workspace:branch:submission-123",
    "commissioner-table:submission:submission-123",
  ]);
  assert.deepEqual(
    getWorkspaceReviewInvalidationTargets(invalidations, "submission-123"),
    ["status"],
  );
});

test("Issue 101 failed synthetic status mutations emit no event", () => {
  const store = new SyntheticRealtimeEventStore();
  const failed = store.commitContractEvent({
    aggregateId: "submission-123",
    commit: false,
    entity: "workspace.status",
    entityId: "submission-123",
    operation: "update",
    pruid: "46",
    resourceVersion: 4,
  });
  assert.deepEqual(failed, { committed: false, events: [] });
});
