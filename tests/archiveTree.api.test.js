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
