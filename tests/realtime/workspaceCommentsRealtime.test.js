import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { SyntheticRealtimeEventStore } from "../../server/realtime/eventStore.js";
import { resolveRealtimeInvalidations } from "../../server/realtime/invalidationRegistry.js";
import {
  getWorkspaceReviewInvalidationKeys,
  getWorkspaceReviewInvalidationTargets,
} from "../../src/lib/realtime/workspaceRealtime.js";

test("Issue 104 maps comment CRUD to only the affected submission thread", () => {
  const identity = {
    aggregateId: "submission-123",
    entity: "workspace.comment",
    entityId: "comment-456",
  };

  assert.deepEqual(resolveRealtimeInvalidations(identity), [
    "workspace:comments:submission-123",
  ]);
  assert.deepEqual(getWorkspaceReviewInvalidationKeys("submission-123"), [
    "workspace:comments:submission-123",
  ]);
  assert.deepEqual(getWorkspaceReviewInvalidationTargets(
    resolveRealtimeInvalidations(identity),
    "submission-123",
  ), ["comments"]);
  assert.deepEqual(getWorkspaceReviewInvalidationTargets(
    resolveRealtimeInvalidations(identity),
    "submission-other",
  ), []);
});

test.each(["create", "update", "delete"])(
  "Issue 104 synthetic %s events carry no comment body",
  (operation) => {
    const store = new SyntheticRealtimeEventStore();
    const { events } = store.commitContractEvent({
      aggregateId: "submission-123",
      entity: "workspace.comment",
      entityId: "comment-456",
      operation,
      pruid: "24",
      resourceVersion: new Date().toISOString(),
    });

    assert.deepEqual(Object.keys(events[0]).sort(), [
      "aggregateId",
      "committedAt",
      "entity",
      "entityId",
      "eventId",
      "invalidate",
      "operation",
      "resourceVersion",
      "schemaVersion",
      "scope",
      "sequence",
    ]);
    assert.equal(events[0].entityId, "comment-456");
    assert.equal(Object.hasOwn(events[0], "content"), false);
  },
);
