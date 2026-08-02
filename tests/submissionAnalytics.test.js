import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  buildSubmissionStatusTimeline,
  buildSubmissionStatusTotals,
} from "../src/lib/submissions/analytics.js";

test("submission analytics covers all five Workspace statuses using live row fields", () => {
  const submissions = [
    { status: "pending", created_at: "2026-08-01T10:00:00Z" },
    { status: "accepted", created_at: "2026-08-01T12:00:00Z" },
    { status: "rejected", created_at: "2026-08-02T10:00:00Z" },
    { status: "archive_request", created_at: "2026-08-02T11:00:00Z" },
    { status: "archived", created_at: "2026-08-02T12:00:00Z" },
  ];
  assert.deepEqual(buildSubmissionStatusTotals(submissions), {
    pending: 1, accepted: 1, rejected: 1, "archive-request": 1, archived: 1,
  });
  assert.deepEqual(buildSubmissionStatusTimeline(submissions), [
    { date: "2026-08-01", pending: 1, accepted: 1, rejected: 0, "archive-request": 0, archived: 0 },
    { date: "2026-08-02", pending: 0, accepted: 0, rejected: 1, "archive-request": 1, archived: 1 },
  ]);
});
