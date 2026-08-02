import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  filterAndSortSubmissionRows,
  LIGHTWEIGHT_SUBMISSION_COLUMNS,
  normalizeSubmissionListFilters,
  serializeLightweightSubmission,
} from "../server/lib/submissions/submissionListQuery.js";
import { normalizePublicSubmissionStatus } from "../src/lib/submissions/publicStatus.js";

test("submission list columns exclude every heavy and private body field", () => {
  const selected = new Set(LIGHTWEIGHT_SUBMISSION_COLUMNS.split(","));
  [
    "geometry", "comment", "counter_proposal_revisions", "original_geometry",
    "proposed_geometry", "shared_boundary", "outer_boundary", "validation_report",
    "submission_snapshot",
  ].forEach((field) => assert.equal(selected.has(field), false, field));
});

test("submission list filters normalize before filtering and sorting", () => {
  const filters = normalizeSubmissionListFilters({
    query: "  Alpha   Boundary  ",
    createdFrom: "2026-08-01",
    createdTo: "2026-08-02",
    type: "counter_proposal",
    status: "accepted",
    sort: "title_desc",
  });
  assert.deepEqual(filters, {
    query: "Alpha Boundary",
    createdFrom: "2026-08-01",
    createdTo: "2026-08-02",
    type: "counter-proposal",
    status: "accepted",
    sort: "title-desc",
  });
  const rows = [
    { id: "1", title: "Alpha Boundary A", type: "counter_proposal", status: "accepted", created_at: "2026-08-01T10:00:00Z" },
    { id: "2", title: "Alpha Boundary Z", type: "counter_proposal", status: "accepted", created_at: "2026-08-02T23:59:00Z" },
    { id: "3", title: "Alpha Boundary Wrong", type: "feedback", status: "accepted", created_at: "2026-08-01T12:00:00Z" },
  ];
  assert.deepEqual(filterAndSortSubmissionRows(rows, filters).map((row) => row.id), ["2", "1"]);
});

test("lightweight serializer does not leak source geometry even when a database double supplies it", () => {
  const serialized = serializeLightweightSubmission({
    id: "submission-1",
    user_id: "user-1",
    type: "objection",
    status: "pending",
    created_at: "2026-08-02T00:00:00Z",
    geometry: { secret: true },
    validation_report: { secret: true },
  }, { id: "user-1", email: "person@example.com" });
  assert.equal(Object.hasOwn(serialized, "geometry"), false);
  assert.equal(Object.hasOwn(serialized, "validation_report"), false);
  assert.equal(serialized.profile.email, "person@example.com");
});

test("Public status presentation has exactly Pending and Received semantics", () => {
  assert.equal(normalizePublicSubmissionStatus("pending"), "pending");
  ["accepted", "rejected", "archive-request", "archived", "unknown", null]
    .forEach((status) => assert.equal(normalizePublicSubmissionStatus(status), "processed", status));
});
