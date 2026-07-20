import assert from "node:assert/strict";
import { beforeAll, beforeEach, test } from "@jest/globals";

const values = new Map();
const browserEvents = new EventTarget();
let workspace;

beforeAll(async () => {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this.detail = options.detail;
    }
  };
  globalThis.window = {
    addEventListener: (...args) => browserEvents.addEventListener(...args),
    dispatchEvent: (...args) => browserEvents.dispatchEvent(...args),
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    removeEventListener: (...args) => browserEvents.removeEventListener(...args),
  };
  workspace = await import("../src/services/tempWorkspace.js");
});

beforeEach(() => values.clear());

function submission(status = "accepted") {
  return {
    id: "temporary-submission-1",
    source: "temporary-counter-proposal",
    status,
  };
}

test("archive assignee edits update the shared request and merge gate", async () => {
  const item = submission();
  await workspace.commitWorkspaceAction(item, {
    action: "archive-request",
    email: "alpha@example.com",
    message: "Open archive review.",
    assignees: ["alpha@example.com", "beta@example.com"],
  });

  let request = workspace.getWorkspaceReviewState(item.id).archiveRequest;
  assert.deepEqual(request.assignees, ["alpha@example.com", "beta@example.com"]);
  assert.equal(workspace.canMergeArchiveRequest(request), false);

  workspace.updateWorkspaceArchiveAssignees(
    item.id,
    "alpha@example.com",
    ["alpha@example.com", "gamma@example.com"],
  );
  request = workspace.getWorkspaceReviewState(item.id).archiveRequest;
  assert.deepEqual(request.assignees, ["alpha@example.com", "gamma@example.com"]);

  await workspace.commitWorkspaceAction(
    { ...item, status: "archive-request" },
    {
      action: "archive-vote-accept",
      email: "gamma@example.com",
      message: "Archive approved.",
    },
  );
  request = workspace.getWorkspaceReviewState(item.id).archiveRequest;
  assert.equal(workspace.canMergeArchiveRequest(request), true);
});

test("one archive rejection returns the submission to Accepted and closes the request", async () => {
  const item = submission();
  await workspace.commitWorkspaceAction(item, {
    action: "archive-request",
    email: "alpha@example.com",
    message: "Open archive review.",
    assignees: ["alpha@example.com", "beta@example.com"],
  });

  const result = await workspace.commitWorkspaceAction(
    { ...item, status: "archive-request" },
    {
      action: "archive-vote-reject",
      email: "beta@example.com",
      message: "Keep this submission active.",
    },
  );

  assert.equal(result.status, workspace.WORKSPACE_STATUS.ACCEPTED);
  assert.equal(workspace.getWorkspaceReviewState(item.id).archiveRequest, null);
});

test("custom label names persist as a submission-scoped label catalog", () => {
  const item = submission();
  const catalog = [
    { id: "archive", name: "Archive candidate", color: "#8b5cf6", custom: false },
    { id: "custom-1", name: "Needs boundary verification", color: "#f59e0b", custom: true },
  ];

  workspace.saveWorkspaceLabelCatalog(item.id, catalog);
  workspace.saveWorkspaceLabels(item.id, [catalog[1]]);

  const review = workspace.getWorkspaceReviewState(item.id);
  assert.deepEqual(review.labelCatalog, catalog);
  assert.deepEqual(review.labels, [catalog[1]]);
});
