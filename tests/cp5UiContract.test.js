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
  assert.doesNotMatch(mine, /rejected:\s*"bg-/);
  assert.match(commissioner, /getCommissionerSubmissionTableRows/);
  assert.match(commissioner, /<SubmissionsTable/);
});

test("Workspace waits behind the shared full-page loading UI before rendering its complete tree", () => {
  const workspace = read("src/pages/CommissionerWorkspace.jsx");
  const exact = workspace.indexOf("await getWorkspaceSubmission(focusId");
  const full = workspace.indexOf("await getWorkspaceSubmissions", exact);
  assert.ok(exact >= 0 && full > exact);
  assert.match(workspace, /<RouteLoadingPage label="Loading Workspace submissions…"/);
  assert.doesNotMatch(workspace, /setWorkspaceSubmissions\(\[focused\]\)/);
});

test("Workspace detail hydrates one exact row before its optional sibling list", () => {
  const review = read("src/pages/WorkspaceReview.jsx");
  const exact = review.indexOf("await getSubmissionTableRowById(submissionId)");
  const hydrate = review.indexOf("hydrateWorkspaceSubmission", exact);
  const full = review.indexOf("getWorkspaceSubmissions", hydrate);
  assert.ok(exact >= 0 && hydrate > exact && full > hydrate);
  assert.equal(review.includes("getDaProfiles"), false);
  assert.match(review, /<RouteLoadingPage label="Loading submission workspace…"/);
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
  assert.match(header, /pathname === "\/dashboard\/graphs"[\s\S]*return "\/dashboard\/submissionsTable"/);
  assert.match(header, /pathname\.startsWith\("\/dashboard\/workspace\/"\)[\s\S]*return "\/dashboard\/workspace"/);
  assert.match(header, /workspaceFrom/);
  assert.match(archived, /exportArchivedTreeJson/);
  assert.match(graphs, /exportCommissionerSubmissionsCsv/);
  [table, publicHome, dashboard].forEach((source) => assert.match(source, /RouteLoadingPage/));
  assert.equal(table.includes("RouteLoadingOverlay"), false);
  assert.equal(publicHome.includes("RouteLoadingOverlay"), false);
  assert.equal(dashboard.includes("RouteLoadingOverlay"), false);
});

test("Workspace label and catalog mutations stay scoped, ordered, and optimistic", () => {
  const panel = read("src/components/non_prebuilt/WorkspaceReviewPanel.jsx");
  assert.match(panel, /const mutationPending = pendingIds\.size > 0/);
  assert.match(panel, /setOptimisticSelected\(nextLabels\)/);
  assert.match(panel, /prepareCatalog\(entries/);
  assert.match(panel, /Customized Label/);
  assert.match(panel, /reconcileLabelsInOrder\(nextLabels, persisted\)/);
  assert.match(panel, /onChange=\{updateActiveLabels\}/);
  assert.match(panel, /onCatalogChange=\{updateActiveCatalog\}/);
  assert.match(panel, /key=\{submission\.id\}/);
  assert.match(panel, /review\.submissionId[\s\S]*submission\.id[\s\S]*EMPTY_REVIEW/);
  assert.match(panel, /Labels cannot be empty/);
  assert.match(panel, /}, 5000\)/);
  assert.match(panel, /startsWith\("draft-custom-"\)[\s\S]*clearInvalidCustomLabel[\s\S]*setCatalog/);
  assert.match(panel, /deleteWorkspaceLabelCatalog\(label\.id, submissionId\)/);
  assert.match(panel, /refreshSequence\.current !== sequence/);
  assert.doesNotMatch(
    panel.slice(panel.indexOf("async function toggleAssignee"), panel.indexOf("async function runAction")),
    /onCommitted\(/,
  );
});
