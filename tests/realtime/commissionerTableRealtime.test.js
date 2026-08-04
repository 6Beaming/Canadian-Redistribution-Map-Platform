import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  getRealtimeSubmissionId,
  reconcileCommissionerSubmissionRows,
} from "../../src/lib/realtime/workspaceRealtime.js";

test("Issue 102 replaces one Commissioner Table row without resetting row order", () => {
  const current = [
    { id: "submission-2", submittedAt: "2026-08-02T00:00:00Z", status: "pending" },
    { id: "submission-1", submittedAt: "2026-08-01T00:00:00Z", status: "pending" },
  ];
  const updated = { ...current[1], status: "accepted" };
  const event = { aggregateId: "submission-1", entity: "workspace.status", operation: "update" };
  const hints = ["commissioner-table:submission:submission-1"];

  assert.equal(getRealtimeSubmissionId({ event, hints }), "submission-1");
  assert.deepEqual(
    reconcileCommissionerSubmissionRows(current, event, updated, hints),
    [current[0], updated],
  );
});

test("Issue 102 adds new rows and removes only supported submission deletes", () => {
  const current = [
    { id: "submission-1", submittedAt: "2026-08-01T00:00:00Z", status: "pending" },
  ];
  const created = { id: "submission-2", submittedAt: "2026-08-02T00:00:00Z", status: "pending" };

  assert.deepEqual(reconcileCommissionerSubmissionRows(
    current,
    { aggregateId: "submission-2", entity: "submission", operation: "create" },
    created,
  ), [created, current[0]]);
  assert.deepEqual(reconcileCommissionerSubmissionRows(
    current,
    { aggregateId: "submission-1", entity: "submission", operation: "delete" },
    null,
  ), []);
});
