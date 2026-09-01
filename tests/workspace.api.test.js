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

test("workspace status route rejects archive-owned status writes", async () => {
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: commissioner }, error: null }),
      },
    }),
    getSupabaseProfile: async () => commissioner,
    getSupabaseAdminDataClient: () => ({
      from() {
        throw new Error("archive-owned status writes must not touch submissions");
      },
    }),
  });

  const response = await request("PATCH", "/api/workspace/submissions/submission-1/status", {
    body: { status: "archive-request" },
    cookie: "crmp_access_token=access-token",
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "ARCHIVE_OWNED_STATUS");
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

test("archive merge rejects a submission without an approved sealed Archive Request", async () => {
  let called;
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: commissioner }, error: null }) },
    }),
    getSupabaseProfile: async () => commissioner,
    getSupabaseAdminDataClient: () => ({
      from(table) {
        if (table === "workspace_archive_requests") {
          return {
            select() { return this; },
            eq() { return this; },
            maybeSingle: async () => ({ data: null, error: null }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
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

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "ARCHIVE_REQUEST_NOT_APPROVED");
  assert.equal(called, undefined);
});

test("legacy branch-key Archived Tree revert is retired", async () => {
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

  assert.equal(response.status, 410);
  assert.equal(response.body.code, "ARCHIVE_V2_REQUIRED");
  assert.equal(called, undefined);
});

test("legacy branch-key Archived Tree delete is retired", async () => {
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

  assert.equal(response.status, 410);
  assert.equal(response.body.code, "ARCHIVE_V2_REQUIRED");
  assert.equal(called, undefined);
});
