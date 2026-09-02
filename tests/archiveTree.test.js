import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  buildArchiveTree,
  filterArchiveTree,
  findArchiveVersion,
  getArchiveVersionRouteId,
} from "../src/lib/archiveTree.js";
import { mapVersionRecord } from "../server/lib/archive/archiveRepository.js";

function record(id, mergedAt, extra = {}) {
  return {
    mergedAt,
    mergedBy: `${id}@example.com`,
    submission: {
      id,
      type: "counter-proposal",
      dguid: "da-2",
      neighboring_dguid: "da-1",
      title: `Version ${id}`,
      ...extra,
    },
  };
}

test("Archived Tree groups a DA pair into an ordered version branch", () => {
  const records = [
    record("version-2", "2026-07-20T10:00:00.000Z"),
    record("version-1", "2026-07-19T10:00:00.000Z"),
  ];
  const categories = buildArchiveTree(records);
  const branch = categories.find((entry) => entry.id === "counter-proposals").branches[0];

  assert.equal(branch.key, "counter-proposal:da-1|da-2");
  assert.deepEqual(branch.versions.map((version) => version.label), ["v1", "v2"]);
  assert.equal(branch.latestVersion.id, "version-2");
  assert.equal(findArchiveVersion(categories, "version-1").branch.key, branch.key);
});

test("the Supabase is_latest marker selects an older real snapshot as Latest", () => {
  const records = [
    record("version-1", "2026-07-19T10:00:00.000Z"),
    record("version-2", "2026-07-20T10:00:00.000Z"),
  ];
  records[0].isLatest = true;
  records[1].isLatest = false;
  const categories = buildArchiveTree(records);
  const branch = categories.find((entry) => entry.id === "counter-proposals").branches[0];

  assert.equal(branch.latestVersion.id, "version-1");
});

test("archive search matches community name and full submission IDs", () => {
  const profiles = new Map([["da-2", { community_name: "Whitehorse" }]]);
  const categories = buildArchiveTree([record("archive-identifier-123", "2026-07-20T10:00:00.000Z")], profiles);

  assert.equal(filterArchiveTree(categories, "Whitehorse")[2].branches.length, 1);
  assert.equal(filterArchiveTree(categories, "identifier-123")[2].branches.length, 1);
  assert.equal(filterArchiveTree(categories, "Dawson")[2].branches.length, 0);
});

test("mapVersionRecord exposes submission id for migrated v2 projections", () => {
  const mapped = mapVersionRecord(
    {
      id: "branch-1",
      branch_key: "objection:r:da-a|da-b",
      submission_type: "objection",
      release_id: "r",
      primary_dguid: "da-a",
      secondary_dguid: "da-b",
      resource_version: 1,
      head_version_id: "version-1",
    },
    {
      id: "version-1",
      version_number: 1,
      submission_projection: {
        source_submission_id: "submission-migrated",
        type: "objection",
      },
      merged_by: "commissioner-1",
      merged_at: "2026-01-01T00:00:00.000Z",
    },
  );

  assert.equal(mapped.submission.id, "submission-migrated");
  const categories = buildArchiveTree([mapped]);
  assert.equal(categories.find((entry) => entry.id === "objections").branches.length, 1);
});

test("Archived Tree routes persistent version identities and can resolve legacy aliases", () => {
  const categories = buildArchiveTree([{
    ...record("submission-1", "2026-07-20T10:00:00.000Z"),
    versionId: "archive-version-1",
  }]);
  const version = categories[2].branches[0].versions[0];

  assert.equal(getArchiveVersionRouteId(version), "archive-version-1");
  assert.equal(findArchiveVersion(categories, "archive-version-1")?.version, version);
  assert.equal(findArchiveVersion(categories, "submission-1")?.version, version);
});
