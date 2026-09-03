import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";
import {
  isMapFeatureInteractionLocked,
  MAP_INTERACTION_MODE,
} from "../src/lib/map/interactionMode.js";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("My Submissions rows support mouse and keyboard navigation", () => {
  const source = read("src/pages/MySubmissions.jsx");
  assert.match(source, /role="link"/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(source, /navigate\(`\/submissions\/\$\{encodeURIComponent\(row\.original\.id\)\}`\)/);
});

test("public submission detail is a read-only single-submission map", () => {
  const source = read("src/pages/UserResumeSubmission.jsx");
  assert.match(source, /getSubmissionMapView\(submissionId\)/);
  assert.match(source, /MAP_INTERACTION_MODE\.SUBMISSION_READONLY/);
  assert.match(source, /loadSubmissionCount=\{false\}/);
  assert.doesNotMatch(source, /WorkspaceReviewPanel|workspaceApi|getWorkspaceSubmissions/);
  assert.doesNotMatch(source, /FeaturePlaceholder/);
  assert.doesNotMatch(source, /Submit Comment|Accept Submission|Reject Submission|Archive Request/);
  assert.equal(
    isMapFeatureInteractionLocked(MAP_INTERACTION_MODE.SUBMISSION_READONLY),
    true,
  );
});

test("submission map API adapter preserves an immutable-release seam", () => {
  const source = read("src/services/submissionMapViewApi.js");
  assert.match(source, /\/api\/submissions\/\$\{encodeURIComponent\(submissionId\)\}\/map-view/);
  assert.match(source, /hydrateSubmissionMapView/);
  assert.match(source, /loadSubmissionMapPresentation/);
  assert.match(source, /mapApi\.getReleaseDaPair/);
  assert.match(source, /getSubmissionMaterializedGeometry/);
  assert.doesNotMatch(source, /hydrateWorkspaceSubmission/);
});

test("public submission map uses route readiness and release-native comment/objection loading", () => {
  const page = read("src/pages/UserResumeSubmission.jsx");
  const api = read("src/services/submissionMapViewApi.js");
  assert.match(page, /onInitialPresentationReady/);
  assert.match(page, /signalRouteReady/);
  assert.match(page, /map-first-idle/);
  assert.match(api, /loadSubmissionMapPresentation/);
  assert.match(page, /normalizeType\(submission\.type\) !== "counter-proposal"/);
});

test("workspace counter-proposal hydration uses compact geometry revisions", () => {
  const source = read("src/services/tempCounterProposal.js");
  assert.match(source, /getSubmissionMaterializedGeometry/);
  assert.match(source, /hydrateFromCompactGeometryRevision/);
  assert.match(source, /mapApi\.getReleaseDaPair/);
});

test("route-scoped fullscreen hides Header and restores global state", () => {
  const app = read("src/App.jsx");
  const context = read("src/contexts/MapFullscreenContext.jsx");
  const map = read("src/components/non_prebuilt/MapCanvas.jsx");
  const css = read("src/styles/map.css");

  assert.match(app, /!isFullscreen \? <Header/);
  assert.match(app, /app-route-content--fullscreen/);
  assert.match(context, /location\.pathname/);
  assert.match(context, /event\.key === "Escape"/);
  assert.match(context, /document\.body\.style\.overflow = bodyOverflow/);
  assert.match(context, /returnFocusRef\.current\?\.focus/);
  assert.match(map, /window\.addEventListener\("orientationchange", resizeMap\)/);
  assert.match(map, /aria-pressed/);
  assert.match(css, /\.app-route-content--fullscreen \.map-page[\s\S]*height: 100dvh/);
});
