import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "@jest/globals";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Dashboard cards use the dedicated DGUID API and reject stale responses", () => {
  const api = read("src/services/workspaceApi.js");
  const cards = read("src/components/non_prebuilt/CommissionerSubmissionCollections.jsx");

  const dashboardFunction = api.slice(
    api.indexOf("export async function getDashboardAreaContext"),
    api.indexOf("/** @deprecated Use getDashboardAreaContext"),
  );
  assert.match(dashboardFunction, /\/api\/workspace\/dashboard\/areas\//);
  assert.match(dashboardFunction, /signal/);
  assert.match(dashboardFunction, /relationship/);
  assert.match(dashboardFunction, /inScopeNeighbors/);
  assert.doesNotMatch(dashboardFunction, /getWorkspaceSubmissions/);
  assert.match(cards, /getDashboardAreaContext/);
  assert.match(cards, /new AbortController\(\)/);
  assert.match(cards, /activeRequestId === requestId/);
  assert.match(cards, /controller\.abort\(\)/);
  assert.match(cards, /role="alert"/);
  assert.match(cards, /map-info-panel__scope-notice/);
  assert.match(cards, /relationship !== "in_scope"/);
});

test("Workspace actions stack and panel selectors share styling", () => {
  const workspace = read("src/components/non_prebuilt/WorkspaceReviewPanel.jsx");
  const mapPanel = read("src/components/non_prebuilt/MapInfoPanel.jsx");
  const styles = read("src/styles/panel-select.css");

  assert.match(workspace, /workspace-decision-actions workflow-action-stack/);
  assert.match(workspace, /workspace-review-selector__trigger panel-select__trigger/);
  assert.match(workspace, /workspace-member-selector__trigger panel-select__trigger/);
  assert.match(mapPanel, /map-info-panel__mode-trigger panel-select__trigger/);
  assert.match(styles, /\.workflow-action-stack \{[\s\S]*flex-direction: column/);
  assert.match(styles, /\.workflow-action-stack > button \{[\s\S]*width: 100%/);
  assert.match(styles, /overflow-wrap: anywhere/);
});

test("Enabled rollout imports its submenu icon and isolates local render failures", () => {
  const panel = read("src/components/non_prebuilt/MapInfoPanel.jsx");
  const boundary = read("src/components/non_prebuilt/PanelErrorBoundary.jsx");

  assert.match(panel, /ChevronDown,[\s\S]*ChevronLeft,[\s\S]*from "lucide-react"/);
  assert.match(panel, /area\.daItems\.length \? <ChevronLeft/);
  assert.match(panel, /<PanelErrorBoundary resetKey=\{rolloutCategoryId\}>[\s\S]*<RolloutCategoryPanel/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /Retry panel/);
});
