import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { SyntheticRealtimeEventStore } from "../../server/realtime/eventStore.js";
import { resolveRealtimeInvalidations } from "../../server/realtime/invalidationRegistry.js";
import {
  getWorkspaceReviewInvalidationTargets,
  reconcileWorkspaceCustomLabels,
} from "../../src/lib/realtime/workspaceRealtime.js";

test("Issue 106 maps custom-label CRUD to only the affected submission picker", () => {
  const identity = {
    aggregateId: "submission-123",
    entity: "workspace.custom-label",
    entityId: "custom-label-456",
  };

  assert.deepEqual(resolveRealtimeInvalidations(identity), [
    "workspace:custom-labels:submission-123",
  ]);
  assert.deepEqual(getWorkspaceReviewInvalidationTargets(
    resolveRealtimeInvalidations(identity),
    "submission-123",
  ), ["labelCatalog"]);
  assert.deepEqual(getWorkspaceReviewInvalidationTargets(
    resolveRealtimeInvalidations(identity),
    "submission-other",
  ), []);
});

test("Issue 106 reconciles selected custom labels by stable ID", () => {
  const fixed = { id: "fixed", custom: false, name: "Fixed", color: "blue" };
  const renamed = { id: "custom-1", custom: true, name: "Old", color: "red" };
  const deleted = { id: "custom-2", custom: true, name: "Deleted", color: "black" };
  const catalog = [
    fixed,
    { id: "custom-1", custom: true, name: "Renamed", color: "green" },
  ];

  assert.deepEqual(reconcileWorkspaceCustomLabels([fixed, renamed, deleted], catalog), [
    fixed,
    { id: "custom-1", custom: true, name: "Renamed", color: "green" },
  ]);
});

test.each(["create", "update", "delete"])(
  "Issue 106 synthetic %s events carry IDs and versions without label contents",
  (operation) => {
    const store = new SyntheticRealtimeEventStore();
    const { events } = store.commitContractEvent({
      aggregateId: "submission-123",
      entity: "workspace.custom-label",
      entityId: "custom-label-456",
      operation,
      pruid: "24",
      resourceVersion: 9,
    });

    assert.equal(events[0].entityId, "custom-label-456");
    assert.equal(events[0].resourceVersion, 9);
    assert.equal(Object.hasOwn(events[0], "name"), false);
    assert.equal(Object.hasOwn(events[0], "color"), false);
    assert.equal(Object.hasOwn(events[0], "custom"), false);
  },
);
