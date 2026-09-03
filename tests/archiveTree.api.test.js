import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";

import app from "../server/app.js";
import { resetApiTestState } from "./helpers/resetApiTestState.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";

const cookie = "crmp_access_token=access-token";
const commissioner = {
  id: "commissioner-1",
  email: "commissioner@example.com",
  role: "commissioner",
  province: "YT",
};

afterEach(() => {
  resetApiTestState();
});

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

test("archive-tree route returns v2 archive records", async () => {
  let versionSelect = "";
  authenticate(commissioner, {
    from(table) {
      if (table === "archive_branches") {
        return {
          select() { return this; },
          order() {
            return Promise.resolve({
              data: [{
                id: "branch-1",
                branch_key: "comment:statscan-da-2021-r1:2021S051260010118",
                submission_type: "comment",
                release_id: "statscan-da-2021-r1",
                primary_dguid: "2021S051260010118",
                secondary_dguid: null,
                head_version_id: "version-1",
                head_version_number: 1,
                resource_version: 1,
                scope_pruids: ["60"],
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              }],
              error: null,
            });
          },
        };
      }
      if (table === "archive_versions") {
        return {
          select(columns) {
            versionSelect = String(columns ?? "");
            return this;
          },
          in() { return this; },
          order() {
            return Promise.resolve({
              data: [{
                id: "version-1",
                branch_id: "branch-1",
                version_number: 1,
                merge_sequence: 1,
                version_kind: "merge",
                source_submission_id: "submission-1",
                title: "Archived comment",
                community_name: "Whitehorse",
                submission_projection: {
                  id: "submission-1",
                  type: "feedback",
                  title: "Archived comment",
                  comment: "Comment body",
                  dguid: "2021S051260010118",
                },
                geometry_digest: null,
                validation_report: { impact_summary: { version: 1 } },
                closing_comment: { content: "Closing note" },
                merged_by: "commissioner-1",
                merged_at: "2026-01-01T00:00:00.000Z",
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
  });
  const response = await request("/api/workspace/archive-tree");
  assert.equal(response.status, 200);
  assert.equal(response.body.source, "v2");
  assert.equal(response.body.records.length, 1);
  assert.equal(response.body.records[0].submission.title, "Archived comment");
  assert.equal(response.body.records[0].submission.id, "submission-1");
  assert.equal(response.body.records[0].submission.comment, undefined);
  assert.equal("validationReport" in response.body.records[0], false);
  assert.equal("closingComment" in response.body.records[0], false);
  assert.match(versionSelect, /source_submission_id/);
  assert.doesNotMatch(versionSelect, /validation_report/);
  assert.doesNotMatch(versionSelect, /closing_comment/);
  assert.doesNotMatch(versionSelect, /submission_projection(?!->>)/);
});

test("archive-tree route requires commissioner access", async () => {
  authenticate({
    ...commissioner,
    role: "public_user",
    first_name: "Public",
    last_name: "User",
    province: "YT",
    postal_code: "Y1A 1A1",
    phone: "8675550100",
  });
  const response = await request("/api/workspace/archive-tree");
  assert.equal(response.status, 403);
});

test("legacy archive version geometry is no longer addressable by legacy archive_tree IDs", async () => {
  authenticate(commissioner, {
    from(table) {
      if (table === "archive_versions") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  });

  const response = await request("/api/workspace/archive-tree/versions/legacy-cp-version/geometry?representation=display");
  assert.equal(response.status, 404);
});

test("archive-map projections groups comments and pair branches for a DGUID", async () => {
  authenticate(commissioner, {
    from(table) {
      if (table === "archive_branches") {
        return {
          select() { return this; },
          or() {
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
