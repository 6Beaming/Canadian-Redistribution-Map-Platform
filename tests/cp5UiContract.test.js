import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

test("Public and Commissioner tables use the lightweight service without changing table ownership", () => {
  const mine = read("src/pages/MySubmissions.jsx");
  const commissioner = read("src/pages/DashboardSubmissionsTable/DashboardSubmissionsPage.jsx");
  assert.match(mine, /getMySubmissionTableRows/);
  assert.match(mine, /normalizePublicSubmissionStatus/);
  assert.match(mine, /received:[\s\S]*pending:/);
  assert.doesNotMatch(mine, /rejected:\s*"bg-/);
  assert.match(commissioner, /getCommissionerSubmissionTableRows/);
  assert.match(commissioner, /<SubmissionsTable/);
});

test("focused Workspace renders the exact row before one background lightweight list", () => {
  const workspace = read("src/pages/CommissionerWorkspace.jsx");
  const exact = workspace.indexOf("await getWorkspaceSubmission(focusId");
  const render = workspace.indexOf("setWorkspaceSubmissions([focused])", exact);
  const background = workspace.indexOf("await getWorkspaceSubmissions", render);
  assert.ok(exact >= 0 && render > exact && background > render);
  assert.match(workspace, /setIsLoading\(false\);[\s\S]*await getWorkspaceSubmissions/);
  assert.match(workspace, /Loading Workspace submissions…/);
});

test("Workspace detail hydrates one exact row before its optional sibling list", () => {
  const review = read("src/pages/WorkspaceReview.jsx");
  const exact = review.indexOf("await getSubmissionTableRowById(submissionId)");
  const hydrate = review.indexOf("hydrateWorkspaceSubmission", exact);
  const full = review.indexOf("getWorkspaceSubmissions", hydrate);
  assert.ok(exact >= 0 && hydrate > exact && full > hydrate);
  assert.equal(review.includes("getDaProfiles"), false);
  assert.match(review, /Loading map detail…/);
});

test("CP5 navigation, readiness loading, and export entry points remain wired", () => {
  const table = read("src/pages/DashboardSubmissionsTable/DashboardSubmissionsPage.jsx");
  const mapCards = read("src/components/non_prebuilt/CommissionerSubmissionCollections.jsx");
  const header = read("src/pages/Header.jsx");
  const archived = read("src/pages/ArchivedTree.jsx");
  const graphs = read("src/pages/DashboardGraphs.jsx");
  const publicHome = read("src/pages/UserHome.jsx");
  const dashboard = read("src/pages/DashboardHome.jsx");

  assert.match(table, /state: \{ from: "\/dashboard\/submissionsTable" \}/);
  assert.match(mapCards, /state: \{ from: "\/dashboard" \}/);
  assert.match(header, /pathname === "\/dashboard\/archivedTree"[\s\S]*return "\/dashboard\/workspace"/);
  assert.match(header, /workspaceFrom/);
  assert.match(archived, /exportArchivedTreeJson/);
  assert.match(graphs, /exportCommissionerSubmissionsCsv/);
  [table, publicHome, dashboard].forEach((source) => assert.match(source, /RouteLoadingPage/));
  assert.equal(table.includes("RouteLoadingOverlay"), false);
  assert.equal(publicHome.includes("RouteLoadingOverlay"), false);
  assert.equal(dashboard.includes("RouteLoadingOverlay"), false);
});

test("Workspace label and catalog mutations serialize and reconcile through the guarded server refresh", () => {
  const panel = read("src/components/non_prebuilt/WorkspaceReviewPanel.jsx");
  assert.match(panel, /const mutationPending = pendingIds\.size > 0/);
  assert.match(panel, /const persisted = await saveWorkspaceLabels[\s\S]*await onChange\(persisted\)/);
  assert.match(panel, /onChange=\{refreshReview\}/);
  assert.match(panel, /onCatalogChange=\{refreshReview\}/);
  assert.match(panel, /refreshSequence\.current !== sequence/);
});
