import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { SyntheticRealtimeEventStore } from "../../server/realtime/eventStore.js";
import { resolveRealtimeInvalidations } from "../../server/realtime/invalidationRegistry.js";
import {
  getWorkspaceReviewInvalidationKeys,
  getWorkspaceReviewInvalidationTargets,
} from "../../src/lib/realtime/workspaceRealtime.js";

test("Issue 105 maps assigned-label CRUD to the selected submission and its branch", () => {
  const identity = {
    aggregateId: "submission-123",
    entity: "workspace.label",
    entityId: "label-456",
  };

  assert.deepEqual(resolveRealtimeInvalidations(identity), [
    "workspace:labels:submission-123",
    "workspace:branch:submission-123",
  ]);
  assert.deepEqual(getWorkspaceReviewInvalidationKeys("submission-123"), [
    "workspace:comments:submission-123",
    "workspace:labels:submission-123",
  ]);
  assert.deepEqual(getWorkspaceReviewInvalidationTargets(
    resolveRealtimeInvalidations(identity),
    "submission-123",
  ), ["labels"]);
});

test.each(["create", "update", "delete"])(
  "Issue 105 synthetic %s events keep label data behind authorized HTTP",
  (operation) => {
    const store = new SyntheticRealtimeEventStore();
    const { events } = store.commitContractEvent({
      aggregateId: "submission-123",
      entity: "workspace.label",
      entityId: "label-456",
      operation,
      pruid: "24",
      resourceVersion: 7,
    });

    assert.equal(events[0].entityId, "label-456");
    assert.equal(events[0].resourceVersion, 7);
    assert.equal(Object.hasOwn(events[0], "name"), false);
    assert.equal(Object.hasOwn(events[0], "color"), false);
    assert.equal(Object.hasOwn(events[0], "labels"), false);
  },
);
