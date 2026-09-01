import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";
import {
  buildArchivedTreeLayout,
  measureWrappedText,
} from "../src/lib/archiveTreeLayout.js";

function measurementContext() {
  return {
    font: "",
    save() {},
    restore() {},
    measureText(value) { return { width: String(value).length * 7 }; },
  };
}

function branch(key, label, versionCount = 1) {
  return {
    key,
    label,
    communityName: "A community name that needs a stable measured layout",
    versions: Array.from({ length: versionCount }, (_, index) => ({ id: `${key}-${index}` })),
  };
}

test("Archived Tree wraps long labels instead of squeezing glyphs", () => {
  const measured = measureWrappedText(
    measurementContext(),
    "2021S051260010281 / 2021S051260010304",
    { maxWidth: 110, maxLines: 2 },
  );
  assert.equal(measured.lines.length, 2);
  assert.equal(measured.truncated, true);
  assert.match(measured.lines[1], /…$/u);

  const canvas = fs.readFileSync("src/components/non_prebuilt/ArchivedTreeCanvas.jsx", "utf8");
  assert.doesNotMatch(canvas, /fillText\([^\n]+maxWidth/);
});

test("Archived Tree gives the super root its own column and non-overlapping subtrees", () => {
  const categories = [
    { id: "comments", title: "Comments", description: "Comment branches", color: "#099", count: 4, branches: [branch("c1", "DA 1"), branch("c2", "DA 2"), branch("c3", "DA 3"), branch("c4", "DA 4")] },
    { id: "objections", title: "Objections", description: "Objection branches", color: "#088", count: 1, branches: [branch("o1", "DA 1 / DA 2", 2)] },
    { id: "counter-proposals", title: "Counter-Proposals", description: "Counter-Proposal branches", color: "#077", count: 2, branches: [branch("p1", "DA 1 / DA 3", 2), branch("p2", "DA 2 / DA 4", 2)] },
  ];
  const layout = buildArchivedTreeLayout(measurementContext(), categories, {
    expandedCategories: new Set(["comments"]),
    expandedBranches: new Set(["o1", "p1"]),
  });
  assert.ok(layout.superRoot.x + layout.superRoot.width < layout.categories[0].root.x);
  for (let index = 1; index < layout.categories.length; index += 1) {
    const previous = layout.categories[index - 1];
    const current = layout.categories[index];
    assert.ok(previous.top + previous.subtreeHeight < current.top);
  }
  layout.categories.forEach((category) => {
    for (let index = 1; index < category.branches.length; index += 1) {
      const previous = category.branches[index - 1].node;
      const current = category.branches[index].node;
      assert.ok(previous.y + previous.height < current.y);
    }
  });
});

test("Archived Tree version actions expose one plan-compliant action per version", () => {
  const panel = fs.readFileSync("src/components/non_prebuilt/ArchivedTreePanel.jsx", "utf8");
  assert.match(panel, /Open the map view/);
  assert.match(panel, /View difference and revert/);
  assert.doesNotMatch(panel, /disabled=\{entryIsLatest\}/);
  assert.doesNotMatch(panel, /archive-panel-revert/);
});
