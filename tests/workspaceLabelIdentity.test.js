import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  isDraftCustomLabelId,
  isSameLabel,
  labelIdentity,
  prepareCatalog,
  reconcileLabelsInOrder,
  selectionFingerprint,
} from "../src/lib/workspace/labelIdentity.js";
import { mergeCatalogFromServer } from "../src/lib/workspace/catalogMerge.js";
import { createLabelMutationQueue } from "../src/lib/workspace/labelMutationQueue.js";
import { createEchoSuppressor, workspaceReviewHint } from "../src/lib/workspace/echoSuppression.js";

test("labelIdentity distinguishes standard keys from custom ids", () => {
  assert.equal(labelIdentity({ key: "needs-review", id: "uuid-1" }), "needs-review");
  assert.equal(labelIdentity({ custom: true, id: "custom-uuid" }), "custom-uuid");
});

test("isSameLabel compares labels by identity", () => {
  assert.equal(
    isSameLabel({ key: "a", id: "1" }, { key: "a", id: "2" }),
    true,
  );
  assert.equal(
    isSameLabel({ custom: true, id: "x" }, { custom: true, id: "y" }),
    false,
  );
});

test("reconcileLabelsInOrder preserves reference order and appends extras", () => {
  const reference = [
    { key: "a", id: "1", name: "A" },
    { key: "b", id: "2", name: "B" },
  ];
  const persisted = [
    { key: "a", id: "1", name: "A" },
    { key: "b", id: "2", name: "B updated" },
    { key: "c", id: "3", name: "C" },
  ];
  const reconciled = reconcileLabelsInOrder(reference, persisted);
  assert.deepEqual(reconciled.map((label) => label.key), ["a", "b", "c"]);
  assert.equal(reconciled[1].name, "B updated");
});

test("prepareCatalog sorts standard labels before custom placeholders", () => {
  const catalog = prepareCatalog([
    { id: "draft-custom-1", custom: true, name: "custom cyan", createdBy: null },
    { id: "std-1", custom: false, name: "Standard" },
  ]);
  assert.equal(catalog[0].name, "Standard");
  assert.equal(catalog[1].placeholder, "Customized Label 1");
});

test("mergeCatalogFromServer keeps local drafts and updates server rows", () => {
  const current = [
    { id: "draft-custom-9", custom: true, name: "Draft" },
    { id: "server-1", custom: true, name: "Old", createdBy: "user-1" },
  ];
  const server = [
    { id: "server-1", custom: true, name: "Saved", createdBy: "user-1" },
    { id: "server-2", custom: true, name: "New", createdBy: "user-1" },
  ];
  const merged = mergeCatalogFromServer(current, server);
  assert.ok(merged.some((entry) => entry.id === "draft-custom-9"));
  assert.ok(merged.some((entry) => entry.id === "server-1" && entry.name === "Saved"));
  assert.ok(merged.some((entry) => entry.id === "server-2"));
});

test("isDraftCustomLabelId detects draft ids", () => {
  assert.equal(isDraftCustomLabelId("draft-custom-123"), true);
  assert.equal(isDraftCustomLabelId("real-uuid"), false);
});

test("selectionFingerprint tracks label identity sets", () => {
  const left = selectionFingerprint([
    { key: "b", id: "2" },
    { key: "a", id: "1" },
  ]);
  const right = selectionFingerprint([
    { key: "a", id: "9" },
    { key: "b", id: "8" },
  ]);
  assert.equal(left, right);
  assert.notEqual(left, selectionFingerprint([{ key: "a", id: "1" }]));
});

test("label mutation queue runs tasks sequentially", async () => {
  const queue = createLabelMutationQueue();
  const order = [];
  await Promise.all([
    queue.enqueue(async () => {
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }),
    queue.enqueue(async () => {
      order.push(2);
    }),
  ]);
  assert.deepEqual(order, [1, 2]);
});

test("label mutation queue flush drops pending tasks", async () => {
  const queue = createLabelMutationQueue();
  let ran = false;
  const first = queue.enqueue(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    ran = true;
  });
  queue.flush();
  await queue.enqueue(async () => {
    ran = true;
  });
  await first.catch(() => {});
  assert.equal(ran, true);
});

test("echo suppressor filters hints within ttl", () => {
  const suppressor = createEchoSuppressor({ ttlMs: 2500 });
  const hint = workspaceReviewHint("sub-1", "comments");
  suppressor.mark([hint]);
  assert.equal(suppressor.isSuppressed(hint), true);
  assert.deepEqual(suppressor.filter([hint, "other"]), ["other"]);
});
