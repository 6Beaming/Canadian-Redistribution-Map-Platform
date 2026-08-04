import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { SyntheticRealtimeEventStore } from "../../server/realtime/eventStore.js";
import { resolveRealtimeInvalidations } from "../../server/realtime/invalidationRegistry.js";
import {
  getRealtimeSubmissionId,
  reconcileWorkspaceSubmission,
} from "../../src/lib/realtime/workspaceRealtime.js";

test("Issue 103 maps a submission event to its exact Workspace row and derived branch", () => {
  assert.deepEqual(resolveRealtimeInvalidations({
    aggregateId: "submission-123",
    entity: "submission",
  }), [
    "workspace:submission:submission-123",
    "workspace:branch:submission-123",
    "commissioner-table:submission:submission-123",
  ]);
});

test("Issue 103 synthetic events match the frozen identifier-only contract", () => {
  const store = new SyntheticRealtimeEventStore();
  const result = store.commitContractEvent({
    aggregateId: "submission-123",
    entity: "submission",
    entityId: "submission-123",
    operation: "update",
    pruid: "24",
    resourceVersion: 2,
  });

  assert.equal(result.committed, true);
  assert.equal(result.events[0].aggregateId, "submission-123");
  assert.deepEqual(result.events[0].invalidate, [
    "workspace:submission:submission-123",
    "workspace:branch:submission-123",
    "commissioner-table:submission:submission-123",
  ]);
  assert.equal(Object.hasOwn(result.events[0], "submission"), false);
});

test("Issue 103 emits no synthetic event for a rolled-back mutation", () => {
  const store = new SyntheticRealtimeEventStore();
  const result = store.commitContractEvent({
    aggregateId: "submission-123",
    commit: false,
    entity: "submission",
    entityId: "submission-123",
    operation: "update",
    pruid: "24",
    resourceVersion: 2,
  });

  assert.deepEqual(result, { committed: false, events: [] });
  assert.equal(store.deliveries.length, 0);
});

test("Issue 103 reconciles one lightweight row without replacing the whole list", () => {
  const current = [
    { id: "submission-1", created_at: "2026-01-01T00:00:00.000Z", status: "pending" },
    { id: "submission-2", created_at: "2026-01-02T00:00:00.000Z", status: "pending" },
  ];
  const updated = {
    id: "submission-1",
    created_at: "2026-01-01T00:00:00.000Z",
    status: "accepted",
  };

  assert.deepEqual(
    reconcileWorkspaceSubmission(current, {
      aggregateId: "submission-1",
      entity: "submission",
      operation: "update",
    }, updated),
    [current[1], updated],
  );
  assert.deepEqual(
    reconcileWorkspaceSubmission(current, {
      aggregateId: "submission-1",
      entity: "submission",
      operation: "delete",
    }, null),
    [current[1]],
  );
});

test("Issue 103 resolves Archive Request invalidations back to the submission row", () => {
  const event = { aggregateId: "archive-request-1", entity: "workspace.archive-request" };
  const hints = ["workspace:submission:submission-123"];
  assert.equal(getRealtimeSubmissionId({ event, hints }), "submission-123");
});
