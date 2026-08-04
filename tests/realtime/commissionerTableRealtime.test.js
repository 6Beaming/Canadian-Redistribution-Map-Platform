import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  getRealtimeSubmissionId,
  reconcileCommissionerSubmissionRows,
  reconcileCommissionerSubmissionSnapshot,
  reconcileCommissionerSubmissionView,
  revealCommissionerSubmissionRows,
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

test("new Commissioner Table rows stay buffered until the viewer reveals them", () => {
  const visible = {
    id: "submission-1",
    submittedAt: "2026-08-01T00:00:00Z",
    status: "pending",
  };
  const newest = {
    id: "submission-3",
    submittedAt: "2026-08-03T00:00:00Z",
    status: "pending",
  };
  const older = {
    id: "submission-2",
    submittedAt: "2026-08-02T00:00:00Z",
    status: "pending",
  };
  let view = { visibleRows: [visible], bufferedRows: [] };

  view = reconcileCommissionerSubmissionView(
    view,
    { aggregateId: older.id, entity: "submission", operation: "create" },
    older,
  );
  view = reconcileCommissionerSubmissionView(
    view,
    { aggregateId: newest.id, entity: "submission", operation: "create" },
    newest,
  );

  assert.deepEqual(view.visibleRows, [visible]);
  assert.deepEqual(view.bufferedRows, [newest, older]);
  assert.deepEqual(revealCommissionerSubmissionRows(view), {
    visibleRows: [newest, older, visible],
    bufferedRows: [],
  });
});

test("existing Commissioner Table rows keep receiving realtime updates", () => {
  const visible = {
    id: "submission-1",
    submittedAt: "2026-08-01T00:00:00Z",
    status: "pending",
  };
  const buffered = {
    id: "submission-2",
    submittedAt: "2026-08-02T00:00:00Z",
    status: "pending",
  };
  const view = { visibleRows: [visible], bufferedRows: [buffered] };

  assert.deepEqual(reconcileCommissionerSubmissionView(
    view,
    { aggregateId: visible.id, entity: "workspace.status", operation: "update" },
    { ...visible, status: "accepted" },
  ), {
    visibleRows: [{ ...visible, status: "accepted" }],
    bufferedRows: [buffered],
  });
  assert.deepEqual(reconcileCommissionerSubmissionView(
    view,
    { aggregateId: buffered.id, entity: "workspace.status", operation: "update" },
    { ...buffered, status: "accepted" },
  ), {
    visibleRows: [visible],
    bufferedRows: [{ ...buffered, status: "accepted" }],
  });
});

test("Commissioner Table resync buffers newly discovered rows without reordering visible rows", () => {
  const visible = {
    id: "submission-1",
    submittedAt: "2026-08-01T00:00:00Z",
    status: "pending",
  };
  const newSubmission = {
    id: "submission-2",
    submittedAt: "2026-08-02T00:00:00Z",
    status: "pending",
  };

  assert.deepEqual(reconcileCommissionerSubmissionSnapshot(
    { visibleRows: [visible], bufferedRows: [] },
    [newSubmission, { ...visible, status: "accepted" }],
  ), {
    visibleRows: [{ ...visible, status: "accepted" }],
    bufferedRows: [newSubmission],
  });
});
