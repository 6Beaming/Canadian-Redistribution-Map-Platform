import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

test("rollout painting is static and contains no timer or blink state", () => {
  const source = fs.readFileSync("src/components/non_prebuilt/MapCanvas.jsx", "utf8");
  assert.equal(source.includes("setInterval"), false);
  assert.equal(source.includes("blinkHidden"), false);
  assert.equal(source.includes("buildBlinkCategoryDaExpression"), false);
  assert.match(source, /FED_ROLLOUT_FILL_EXPRESSION/);
  assert.match(source, /BLOCKED_DA_FILL_EXPRESSION/);
  assert.match(source, /ENABLED_FILL_COLOR/);
  assert.match(source, /DATA_BLOCKED_FILL_COLOR/);
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
