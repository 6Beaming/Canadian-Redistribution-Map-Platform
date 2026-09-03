import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  projectArchiveRequestVisibility,
} from "../server/lib/archiveRequests/visibilityProjection.js";
import { applyCommissionerStatusVisibility } from "../src/services/submissionListsApi.js";

function archiveRequestAdmin(requests) {
  return {
    from(table) {
      assert.equal(table, "workspace_archive_requests");
      let rows = [...requests];
      return {
        select() { return this; },
        in(field, values) {
          rows = rows.filter((row) => values.map(String).includes(String(row[field])));
          return this;
        },
        async order() { return { data: rows, error: null }; },
      };
    },
  };
}

test("Archive Request status is visible to all commissioners; assignee flag gates votes", async () => {
  const row = { id: "submission-1", status: "archive-request" };
  const request = {
    id: "request-1",
    submission_id: row.id,
    requester_id: "requester-1",
    assignee_ids: ["requester-1", "assignee-1"],
    state: "open",
    resource_version: 3,
    created_at: "2026-09-01T12:00:00.000Z",
  };

  const [assigned] = await projectArchiveRequestVisibility(
    archiveRequestAdmin([request]),
    [row],
    "assignee-1",
  );
  const [unassigned] = await projectArchiveRequestVisibility(
    archiveRequestAdmin([request]),
    [row],
    "commissioner-elsewhere",
  );

  assert.equal(applyCommissionerStatusVisibility(assigned).status, "archive-request");
  assert.equal(applyCommissionerStatusVisibility(unassigned).status, "archive-request");
  assert.equal(applyCommissionerStatusVisibility(unassigned).actual_status, "archive-request");
  assert.equal(applyCommissionerStatusVisibility(unassigned).archive_request_status_hidden, false);
  assert.equal(applyCommissionerStatusVisibility(assigned).archive_request_assigned_to_viewer, true);
  assert.equal(applyCommissionerStatusVisibility(unassigned).archive_request_assigned_to_viewer, false);
});

test("requester remains visible as an assignee for a legacy request row", async () => {
  const [projected] = await projectArchiveRequestVisibility(
    archiveRequestAdmin([{
      id: "request-legacy",
      submission_id: "submission-legacy",
      requester_id: "requester-1",
      assignee_ids: [],
      state: "open",
      resource_version: 1,
      created_at: "2026-08-01T12:00:00.000Z",
    }]),
    [{ id: "submission-legacy", status: "archive-request" }],
    "requester-1",
  );

  assert.equal(projected.visible_status, "archive-request");
  assert.equal(projected.archive_request_assigned_to_viewer, true);
});
