import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

const styles = fs.readFileSync("src/styles/workspace.css", "utf8");
const workspace = fs.readFileSync("src/pages/CommissionerWorkspace.jsx", "utf8");

function rule(selector, source = styles) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `Missing CSS rule: ${selector}`);
  return match[1];
}

test("Workspace owns horizontal overflow instead of creating a second body scrollbar", () => {
  assert.match(rule(".commissioner-workspace.workspace-page"), /overflow:\s*hidden/);
  assert.match(rule(".workspace-scroll-region"), /overflow:\s*auto/);
  assert.match(rule(".workspace-tree__top-row"), /min-inline-size:\s*max-content/);
});

test("Workspace status key keeps all four status labels inside a reliable desktop card", () => {
  const card = rule(".workspace-status-key");
  const items = rule(".workspace-status-key__items");
  const item = rule(".workspace-status-key__item");

  assert.match(card, /box-sizing:\s*border-box/);
  assert.match(card, /inline-size:\s*24rem/);
  assert.match(card, /min-inline-size:\s*24rem/);
  assert.match(items, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(item, /min-inline-size:\s*0/);
  assert.match(item, /white-space:\s*normal/);
  assert.match(item, /overflow-wrap:\s*anywhere/);

  ["Pending Submissions", "Archive Request", "Accepted", "Rejected"].forEach((label) => {
    assert.match(workspace, new RegExp(`"${label}"`));
  });
  assert.match(workspace, /<aside className="workspace-status-key" aria-label="Status key">/);
});

test("Workspace status key becomes one column at the true mobile breakpoint", () => {
  const mobile = styles.match(/@media \(max-width:\s*700px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(mobile, "Missing Workspace mobile breakpoint");
  assert.match(mobile[1], /\.workspace-status-key\s*\{[\s\S]*?inline-size:\s*min\(100%,\s*24rem\)/);
  assert.match(mobile[1], /min-inline-size:\s*min\(100%,\s*18rem\)/);
  assert.match(mobile[1], /\.workspace-status-key__items\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});
