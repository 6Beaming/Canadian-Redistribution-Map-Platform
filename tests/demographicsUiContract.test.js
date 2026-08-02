import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

test("statistics is Public-only and Commissioner defaults to submission comments", () => {
  const panel = fs.readFileSync("src/components/non_prebuilt/MapInfoPanel.jsx", "utf8");
  assert.match(panel, /USER_PANEL_VIEWS[\s\S]*id: "statistics"/);
  assert.doesNotMatch(
    panel.match(/COMMISSIONER_PANEL_VIEWS = \[[\s\S]*?\];/)?.[0] ?? "",
    /id: "statistics"/,
  );
  assert.match(panel, /variant === "commissioner" \? "comments" : "statistics"/);
  assert.doesNotMatch(panel, /CommissionerViewUserStats/);
  assert.doesNotMatch(
    panel,
    /This should be refactored to an aggregation statistical map of user submissions/,
  );
});

test("statistics UI distinguishes states and keeps the InfoPanel body independently scrollable", () => {
  const component = fs.readFileSync("src/pages/UserViewStatistics.jsx", "utf8");
  const styles = fs.readFileSync("src/styles/map.css", "utf8");
  assert.match(component, /Loading statistics…/);
  assert.match(component, /Retry statistics/);
  assert.match(component, /statistics\.availability === "unavailable"/);
  assert.match(component, /Statistics Canada · 2021 Census/);
  assert.match(styles, /\.map-info-panel__content[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/);
  assert.match(styles, /\.map-info-panel__view\s*\{[\s\S]*overflow: hidden;/);
  assert.match(styles, /\.map-info-panel__body\s*\{[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;[\s\S]*overflow-x: hidden;[\s\S]*overscroll-behavior: contain;/);
});
