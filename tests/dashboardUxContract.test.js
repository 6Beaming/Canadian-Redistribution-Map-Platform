import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

test("Dashboard graphs use commissioner analytics for all five status series", () => {
  const page = read("src/pages/DashboardGraphs.jsx");
  const chart = read("src/components/non_prebuilt/submissionsGraph.jsx");
  const analytics = read("src/lib/submissions/analytics.js");

  assert.match(page, /getCommissionerSubmissionAnalytics/);
  assert.match(page, /getCommissionerSubmissionListStore/);
  assert.match(page, /subscribeCommissionerSubmissionTable/);
  assert.match(page, /dailyTimeline=\{analytics\?\.daily/);
  assert.doesNotMatch(page, /Support: 68%|Oppose: 32%|getTotalComments/);
  assert.match(chart, /buildSubmissionStatusTimeline/);
  assert.match(chart, /dailyTimeline != null/);
  ["pending", "accepted", "rejected", "archive-request", "archived"].forEach((status) => {
    assert.match(analytics, new RegExp(`id: "${status}"`));
  });
});

test("postal navigation resets the stale panel selection and the heatmap uses red tones", () => {
  const userHome = read("src/pages/UserHome.jsx");
  const heatmap = read("src/lib/map/heatmap.js");
  const styles = read("src/styles/map.css");

  assert.match(userHome, /function handlePostalAreaActivate|const handlePostalAreaActivate/);
  assert.match(userHome, /setSelection\(null\)/);
  assert.match(userHome, /onPostalAreaActivate=\{handlePostalAreaActivate\}/);
  assert.match(heatmap, /#fed976/);
  assert.match(heatmap, /#800026/);
  assert.match(styles, /\.heatmap-button\.active[\s\S]*#fee2e2/);
});
