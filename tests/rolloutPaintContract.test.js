import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

test("rollout painting is static and highlights only the selected category", () => {
  const source = fs.readFileSync("src/components/non_prebuilt/MapCanvas.jsx", "utf8");
  assert.equal(source.includes("setInterval"), false);
  assert.equal(source.includes("blinkHidden"), false);
  assert.equal(source.includes("buildBlinkCategoryDaExpression"), false);
  assert.match(source, /rolloutSelectionFillExpression/);
  assert.match(source, /categoryId === "data-blocked"/);
  assert.match(source, /ENABLED_FILL_COLOR/);
  assert.match(source, /selectedFedNums, ENABLED_FILL_COLOR, "#ffffff"/);
  assert.doesNotMatch(source, /DATA_BLOCKED_FILL_COLOR/);
  assert.match(source, /const rolloutCategoryIdRef = useRef\(rolloutCategoryId\)/);
  assert.match(source, /applyPresentationModeRef\.current\(rolloutEnabled, rolloutCategoryId\)/);
  assert.match(source, /\[mapReadyTick, rolloutCategoryId, rolloutEnabled\]/);
});

test("drag hot path updates only the small overlay and delegates validation", () => {
  const source = fs.readFileSync("src/components/non_prebuilt/MapCanvas.jsx", "utf8");
  const start = source.indexOf("const pushCounterProposalDragMove");
  const end = source.indexOf("const onMouseMove", start);
  const dragMove = source.slice(start, end);
  assert.match(dragMove, /counter-proposal-drag-overlay/);
  assert.equal(dragMove.includes("counter-proposal-proposal"), false);
  assert.equal(dragMove.includes("fetch("), false);
  assert.equal(dragMove.includes("localStorage"), false);
  assert.equal(dragMove.includes("setCounterProposalWorkflow"), false);
});
