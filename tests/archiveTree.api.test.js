import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";

import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";

const cookie = "crmp_access_token=access-token";
const commissioner = {
  id: "commissioner-1",
  email: "commissioner@example.com",
  role: "commissioner",
  province: "YT",
};

afterEach(() => setSupabaseTestDoubles(null));

async function request(path) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { cookie },
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function authenticate(profile = commissioner, admin = null) {
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: profile }, error: null }) },
    }),
    getSupabaseProfile: async () => profile,
    ...(admin ? { getSupabaseAdminDataClient: () => admin } : {}),
  });
}

function legacyArchiveAdmin() {
  return {
    from(table) {
      if (table === "archive_branches") {
        return {
          select() { return this; },
          order() { return Promise.resolve({ data: [], error: null }); },
        };
      }
      if (table === "archive_tree") {
        return {
          select() { return this; },
          order() {
            return Promise.resolve({
              data: [{
                id: "legacy-1",
                branch_key: "feedback:2021S051260010118",
                version_number: 1,
                is_latest: true,
                submission_snapshot: {
                  id: "submission-1",
                  type: "feedback",
                  dguid: "2021S051260010118",
                  title: "Legacy comment",
                },
                merged_by: "commissioner-1",
                merged_at: "2026-01-01T00:00:00.000Z",
                closing_comment: null,
                reverted_at: null,
                reverted_by: null,
              }],
              error: null,
            });
          },
        };
      }
      if (table === "profiles") {
        return {
          select() { return this; },
          in() {
            return Promise.resolve({
              data: [{ id: "commissioner-1", email: "commissioner@example.com" }],
              error: null,
            });
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

test("archive-tree route falls back to legacy archive_tree records", async () => {
  authenticate(commissioner, legacyArchiveAdmin());
  const response = await request("/api/workspace/archive-tree");
  assert.equal(response.status, 200);
  assert.equal(response.body.source, "legacy");
  assert.equal(response.body.records.length, 1);
  assert.equal(response.body.records[0].submission.title, "Legacy comment");
  assert.equal(response.body.records[0].branchKey, "feedback:2021S051260010118");
});

test("archive-tree route requires commissioner access", async () => {
  authenticate({
    ...commissioner,
    role: "public_user",
    first_name: "Public",
    last_name: "User",
    postal_code: "Y1A 1A1",
    phone: "8675550100",
  });
  const response = await request("/api/workspace/archive-tree");
  assert.equal(response.status, 403);
});

test("archive-map projections groups comments and pair branches for a DGUID", async () => {
  authenticate(commissioner, {
    from(table) {
      if (table === "archive_branches") {
        return {
          select() { return this; },
          order() {
            return Promise.resolve({
              data: [
                {
                  id: "branch-comment",
                  branch_key: "comment:statscan-da-2021-r1:2021S051260010118",
                  submission_type: "comment",
                  release_id: "statscan-da-2021-r1",
                  primary_dguid: "2021S051260010118",
                  secondary_dguid: null,
                  head_version_id: "version-comment",
                  head_version_number: 1,
                  resource_version: 1,
                },
                {
                  id: "branch-objection",
                  branch_key: "objection:statscan-da-2021-r1:2021S051260010118|2021S051260010119",
                  submission_type: "objection",
                  release_id: "statscan-da-2021-r1",
                  primary_dguid: "2021S051260010118",
                  secondary_dguid: "2021S051260010119",
                  head_version_id: "version-objection",
                  head_version_number: 1,
                  resource_version: 1,
                },
              ],
              error: null,
            });
          },
        };
      }
      if (table === "archive_versions") {
        return {
          select() { return this; },
          in() { return this; },
          order() {
            return Promise.resolve({
              data: [
                {
                  id: "version-comment",
                  branch_id: "branch-comment",
                  version_number: 1,
                  merge_sequence: 1,
                  version_kind: "merge",
                  submission_projection: {
                    id: "submission-comment",
                    type: "feedback",
                    title: "Archived comment",
                    comment: "Comment body",
                    dguid: "2021S051260010118",
                  },
                  geometry_digest: null,
                  closing_comment: null,
                  merged_by: "commissioner-1",
                  merged_at: "2026-01-02T00:00:00.000Z",
                },
                {
                  id: "version-objection",
                  branch_id: "branch-objection",
                  version_number: 1,
                  merge_sequence: 1,
                  version_kind: "merge",
                  submission_projection: {
                    id: "submission-objection",
                    type: "objection",
                    title: "Archived objection",
                    comment: "Objection body",
                    dguid: "2021S051260010118",
                    neighboring_dguid: "2021S051260010119",
                  },
                  geometry_digest: null,
                  closing_comment: null,
                  merged_by: "commissioner-1",
                  merged_at: "2026-01-03T00:00:00.000Z",
                },
              ],
              error: null,
            });
          },
        };
      }
      if (table === "profiles") {
        return {
          select() { return this; },
          in() {
            return Promise.resolve({
              data: [{ id: "commissioner-1", email: "commissioner@example.com" }],
              error: null,
            });
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  });

  const response = await request("/api/workspace/archive-map/projections?dguid=2021S051260010118");
  assert.equal(response.status, 200);
  assert.equal(response.body.dguid, "2021S051260010118");
  assert.equal(response.body.comments.length, 1);
  assert.equal(response.body.comments[0].submission.comment, "Comment body");
  assert.equal(response.body.objections.length, 1);
  assert.equal(response.body.objections[0].secondaryDguid, "2021S051260010119");
  assert.equal(response.body.objections[0].versions[0].submission.comment, "Objection body");
});
