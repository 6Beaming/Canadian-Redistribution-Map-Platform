import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { normalizeRealtimeOutboxDelivery } from "../../server/realtime/eventStore.js";
import {
  getWorkspaceReviewInvalidationTargets,
} from "../../src/lib/realtime/workspaceRealtime.js";

test("Issue 107 consumes the CP4 Archive Request outbox identity", () => {
  const event = normalizeRealtimeOutboxDelivery({
    id: "10000000-0000-4000-8000-000000000001",
    aggregate_type: "workspace.archive_request",
    aggregate_id: "20000000-0000-4000-8000-000000000002",
    operation: "update",
    resource_version: 3,
    projection_hints: {
      submissionId: "30000000-0000-4000-8000-000000000003",
      state: "approved",
    },
    committed_at: "2026-08-04T12:00:00.000Z",
  }, {
    pruid: "46",
    scope_sequence: 8,
  });

  assert.equal(event.entity, "workspace.archive-request");
  assert.equal(event.aggregateId, "20000000-0000-4000-8000-000000000002");
  assert.equal(event.entityId, "20000000-0000-4000-8000-000000000002");
  assert.deepEqual(event.invalidate, [
    "workspace:archive-request:30000000-0000-4000-8000-000000000003",
    "workspace:status:30000000-0000-4000-8000-000000000003",
    "workspace:submission:30000000-0000-4000-8000-000000000003",
    "workspace:branch:30000000-0000-4000-8000-000000000003",
    "commissioner-table:submission:30000000-0000-4000-8000-000000000003",
  ]);
  assert.deepEqual(getWorkspaceReviewInvalidationTargets(
    event.invalidate,
    "30000000-0000-4000-8000-000000000003",
  ), ["archiveRequest", "status"]);
  assert.equal(Object.hasOwn(event, "state"), false);
});
