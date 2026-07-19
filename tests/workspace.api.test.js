import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";

import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";

const commissioner = {
  id: "commissioner-1",
  email: "commissioner@example.com",
  role: "commissioner",
};

afterEach(() => setSupabaseTestDoubles(null));

async function request(method, path, { body, cookie } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function authenticate(profile) {
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: profile.id, email: profile.email } }, error: null }),
      },
    }),
    getSupabaseProfile: async () => profile,
  });
}

test("workspace status writes require authentication", async () => {
  const response = await request("PATCH", "/api/workspace/submissions/submission-1/status", {
    body: { status: "accepted" },
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.error, "Authentication is required.");
});

test("workspace status writes require a commissioner", async () => {
  authenticate({
    ...commissioner,
    id: "public-1",
    role: "public_user",
    first_name: "Public",
    last_name: "Reviewer",
    province: "YT",
    postal_code: "Y1A 1A1",
    phone: "8675550100",
  });
  const response = await request("PATCH", "/api/workspace/submissions/submission-1/status", {
    body: { status: "accepted" },
    cookie: "crmp_access_token=access-token",
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "Commissioner access is required.");
});

test("a commissioner can update a supported workspace status", async () => {
  let updatedStatus;
  const query = {
    update(values) { updatedStatus = values.status; return this; },
    eq() { return this; },
    select() { return this; },
    async maybeSingle() {
      return { data: { id: "submission-1", status: updatedStatus }, error: null };
    },
  };

  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: commissioner }, error: null }),
      },
    }),
    getSupabaseProfile: async () => commissioner,
    getSupabaseAdminDataClient: () => ({ from: () => query }),
  });

  const response = await request("PATCH", "/api/workspace/submissions/submission-1/status", {
    body: { status: "archive-request" },
    cookie: "crmp_access_token=access-token",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "archive-request");
  assert.equal(updatedStatus, "archive-request");
});

test("a commissioner can load the archive-reviewer email list", async () => {
  const query = {
    select() { return this; },
    eq() { return this; },
    async order() {
      return {
        data: [
          { email: "alpha@example.com" },
          { email: "beta@example.com" },
        ],
        error: null,
      };
    },
  };

  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: commissioner }, error: null }),
      },
    }),
    getSupabaseProfile: async () => commissioner,
    getSupabaseAdminDataClient: () => ({ from: () => query }),
  });

  const response = await request("GET", "/api/workspace/reviewers", {
    cookie: "crmp_access_token=access-token",
  });

  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(response.body), JSON.stringify(["alpha@example.com", "beta@example.com"]));
});

test("a missing archive table is exposed as an empty archive tree", async () => {
  const query = {
    select() { return this; },
    async order() {
      return { data: null, error: { code: "PGRST205", message: "Table not found" } };
    },
  };

  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: commissioner }, error: null }),
      },
    }),
    getSupabaseProfile: async () => commissioner,
    getSupabaseAdminDataClient: () => ({ from: () => query }),
  });

  const response = await request("GET", "/api/workspace/archive", {
    cookie: "crmp_access_token=access-token",
  });

  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(response.body), "[]");
});

test("a commissioner archive merge uses the atomic Supabase function", async () => {
  let called;
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: commissioner }, error: null }) },
    }),
    getSupabaseProfile: async () => commissioner,
    getSupabaseAdminDataClient: () => ({
      async rpc(name, values) {
        called = { name, values };
        return { data: { submission_id: values.target_submission_id }, error: null };
      },
    }),
  });

  const response = await request("POST", "/api/workspace/archive", {
    cookie: "crmp_access_token=access-token",
    body: { submissionId: "00000000-0000-4000-8000-000000000001", closingComment: { content: "Merged" } },
  });

  assert.equal(response.status, 201);
  assert.equal(called.name, "merge_submission_into_archive");
  assert.equal(called.values.target_merged_by, commissioner.id);
});

test("a commissioner can persist an Archived Tree revert", async () => {
  let called;
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: commissioner }, error: null }) },
    }),
    getSupabaseProfile: async () => commissioner,
    getSupabaseAdminDataClient: () => ({
      async rpc(name, values) {
        called = { name, values };
        return { data: { is_latest: true }, error: null };
      },
    }),
  });

  const response = await request("PATCH", "/api/workspace/archive/branch/latest", {
    cookie: "crmp_access_token=access-token",
    body: { branchKey: "feedback:60010001", submissionId: "00000000-0000-4000-8000-000000000001" },
  });

  assert.equal(response.status, 200);
  assert.equal(called.name, "revert_archive_branch");
  assert.equal(called.values.target_reverted_by, commissioner.id);
});

test("a commissioner can permanently delete an Archived Tree branch", async () => {
  let called;
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: commissioner }, error: null }) },
    }),
    getSupabaseProfile: async () => commissioner,
    getSupabaseAdminDataClient: () => ({
      async rpc(name, values) {
        called = { name, values };
        return { data: ["00000000-0000-4000-8000-000000000001"], error: null };
      },
    }),
  });

  const response = await request("DELETE", "/api/workspace/archive/branch", {
    cookie: "crmp_access_token=access-token",
    body: { branchKey: "feedback:60010001" },
  });

  assert.equal(response.status, 200);
  assert.equal(called.name, "delete_archive_branch");
  assert.equal(response.body.deletedSubmissionIds.length, 1);
});
