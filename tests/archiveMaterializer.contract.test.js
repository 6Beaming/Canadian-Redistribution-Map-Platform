import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  buildArchiveBranchKey,
  geometryDigest,
  normalizeArchiveSubmissionType,
} from "../server/lib/archive/archiveMaterializer.js";

test("buildArchiveBranchKey canonicalizes comment and pair branches", () => {
  assert.equal(
    buildArchiveBranchKey("feedback", "statscan-da-2021-r1", "2021S051260010118"),
    "comment:statscan-da-2021-r1:2021S051260010118",
  );
  assert.equal(
    buildArchiveBranchKey("objection", "statscan-da-2021-r1", "da-b", "da-a"),
    "objection:statscan-da-2021-r1:da-a|da-b",
  );
  assert.equal(
    buildArchiveBranchKey("counter-proposal", "statscan-da-2021-r1", "da-b", "da-a"),
    "counter-proposal:statscan-da-2021-r1:da-a|da-b",
  );
});

test("buildArchiveBranchKey rejects incomplete pair identities", () => {
  assert.throws(
    () => buildArchiveBranchKey("objection", "statscan-da-2021-r1", "da-a", "da-a"),
    /two distinct DGUIDs/i,
  );
});

test("normalizeArchiveSubmissionType maps legacy aliases", () => {
  assert.equal(normalizeArchiveSubmissionType("feedback"), "comment");
  assert.equal(normalizeArchiveSubmissionType("counter-proposal"), "counter_proposal");
  assert.equal(normalizeArchiveSubmissionType("objection"), "objection");
});

test("geometryDigest is stable for equivalent object key order", () => {
  const left = geometryDigest({ b: 2, a: 1 });
  const right = geometryDigest({ a: 1, b: 2 });
  assert.equal(left, right);
  assert.match(left, /^sha256:[a-f0-9]{64}$/);
});
