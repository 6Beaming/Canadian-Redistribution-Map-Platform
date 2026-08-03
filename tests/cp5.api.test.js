import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";
import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";
import { setResourceScopeTestDoubles } from "../server/lib/authorization/resourceScopeGuard.js";

const COOKIE = "crmp_access_token=access-token";
const commissioner = { id: "commissioner-1", email: "eric@example.com", role: "commissioner", province: "NL" };
const publicUser = {
  id: "public-1", email: "public@example.com", role: "public_user",
  first_name: "Public", last_name: "User", province: "NL", postal_code: "A1A 1A1", phone: "7095550100",
};

afterEach(() => {
  setSupabaseTestDoubles(null);
  setResourceScopeTestDoubles(null);
});

async function request(path, { method = "GET", body, cookie = COOKIE } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = Buffer.from(await response.arrayBuffer());
    const text = raw.toString("utf8").replace(/^\uFEFF/u, "");
    return {
      status: response.status,
      headers: response.headers,
      text,
      raw,
      body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text || "null") : null,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authDoubles(profile, admin) {
  setResourceScopeTestDoubles({
    getProfileForDguid: async () => ({ pruid: "10" }),
  });
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: profile }, error: null }) },
    }),
    getSupabaseProfile: async () => profile,
    getSupabaseAdminDataClient: () => admin,
  });
}

function listAdmin(rows, capture = {}) {
  return {
    from(table) {
      if (table === "profiles") {
        return {
          select(columns) { capture.profileColumns = columns; return this; },
          async in(_field, ids) {
            return { data: ids.map((id) => ({ id, email: `${id}@example.com` })), error: null };
          },
        };
      }
      if (table === "submission_scope_pruids") {
        return {
          select() { return this; },
          eq() { return this; },
          insert() { return this; },
          then(resolve, reject) {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          },
        };
      }
      assert.equal(table, "submissions");
      let filtered = [...rows];
      return {
        select(columns) { capture.submissionColumns = columns; return this; },
        eq(field, value) { filtered = filtered.filter((row) => String(row[field]) === String(value)); return this; },
        async order() { return { data: filtered, error: null }; },
        async maybeSingle() { return { data: filtered[0] ?? null, error: null }; },
      };
    },
  };
}

function submissionRows(count = 70) {
  return Array.from({ length: count }, (_, index) => ({
    id: `submission-${String(index).padStart(3, "0")}`,
    user_id: index % 2 ? "public-1" : "public-2",
    type: index % 3 === 0 ? "counter_proposal" : "feedback",
    fed_num: "10002",
    dguid: "2021S051210010165",
    neighboring_dguid: index % 3 === 0 ? "2021S051210010166" : null,
    title: `Submission ${index}`,
    status: index % 2 ? "pending" : "accepted",
    created_at: `2026-08-${String((index % 2) + 1).padStart(2, "0")}T12:00:00.000Z`,
    updated_at: "2026-08-02T12:00:00.000Z",
    geometry: { mustNotLeak: true },
  }));
}

function collaborationAdmin(seed = {}) {
  const state = {
    submissions: [{ id: "submission-1" }],
    workspace_comments: [],
    workspace_label_catalog: [],
    workspace_labels: [],
    ...seed,
  };
  let nextId = 1;

  function rowsFor(table, filters) {
    return (state[table] ?? []).filter((row) =>
      filters.every(([field, value]) => String(row[field]) === String(value)));
  }

  return {
    state,
    from(table) {
      let operation = "read";
      let values = null;
      const filters = [];
      const builder = {
        select() { return this; },
        eq(field, value) { filters.push([field, value]); return this; },
        order: async () => ({ data: rowsFor(table, filters), error: null }),
        insert(input) { operation = "insert"; values = Array.isArray(input) ? input : [input]; return this; },
        update(input) { operation = "update"; values = input; return this; },
        delete() { operation = "delete"; return this; },
        async single() { return this.maybeSingle(); },
        async maybeSingle() {
          if (operation === "insert") {
            const created = values.map((value) => ({
              id: value.id ?? `${table}-${nextId++}`,
              created_at: value.created_at ?? "2026-08-02T12:00:00.000Z",
              updated_at: value.updated_at ?? "2026-08-02T12:00:00.000Z",
              ...value,
            }));
            state[table].push(...created);
            return { data: created[0], error: null };
          }
          const matches = rowsFor(table, filters);
          if (operation === "update") {
            if (!matches[0]) return { data: null, error: null };
            Object.assign(matches[0], values);
            return { data: matches[0], error: null };
          }
          if (operation === "delete") {
            const target = matches[0];
            if (!target) return { data: null, error: null };
            state[table] = state[table].filter((row) => row !== target);
            return { data: target, error: null };
          }
          return { data: matches[0] ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

test("Commissioner list returns all 70 geometry-free rows with normalized filters and one batch profile read", async () => {
  const capture = {};
  authDoubles(commissioner, listAdmin(submissionRows(), capture));
  const response = await request("/api/submissions?query=%20Submission%20%20&createdFrom=2026-08-01&createdTo=2026-08-02&sort=oldest");
  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 70);
  assert.deepEqual(response.body.appliedFilters, {
    query: "Submission", createdFrom: "2026-08-01", createdTo: "2026-08-02",
    type: "", status: "", sort: "oldest",
  });
  assert.equal(capture.submissionColumns.includes("geometry"), false);
  assert.equal(capture.submissionColumns.includes("comment"), false);
  assert.equal(capture.profileColumns, "id,email");
  assert.ok(Buffer.byteLength(response.text) < 100_000);
  assert.equal(response.text.includes("mustNotLeak"), false);
});

test("Public mine route derives ownership from the session and exact-ID route remains Commissioner-only", async () => {
  const rows = submissionRows(12).map((row) => ({ ...row, user_id: "public-1" }));
  rows.push({ ...rows[0], id: "someone-else", user_id: "public-2" });
  authDoubles(publicUser, listAdmin(rows));
  const mine = await request("/api/submissions/mine");
  assert.equal(mine.status, 200);
  assert.equal(mine.body.items.length, 12);
  const exact = await request("/api/submissions/table-row/submission-001");
  assert.equal(exact.status, 403);
});

test("Workspace review content reuses an exact-ID geometry-free submission read", async () => {
  const capture = {};
  const rows = submissionRows(3).map((row, index) => ({ ...row, comment: `Body ${index}` }));
  authDoubles(commissioner, listAdmin(rows, capture));
  const response = await request("/api/comments?submissionId=submission-001");
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].id, "submission-001");
  assert.equal(response.body[0].comment, "Body 1");
  assert.equal(capture.submissionColumns.includes("comment"), true);
  assert.equal(capture.submissionColumns.includes("geometry"), false);
  assert.equal(response.text.includes("mustNotLeak"), false);
});

test("Workspace label replacement returns stable assignment/catalog identities", async () => {
  const rpcCalls = [];
  const admin = {
    from(table) {
      assert.equal(table, "submissions");
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: { id: "submission-1" }, error: null }; },
      };
    },
    async rpc(name, values) {
      rpcCalls.push({ name, values });
      return {
        data: [{
          id: "assignment-1", catalog_id: "catalog-1", submission_id: "submission-1",
          name: "Custom Label 1", color: "cyan", is_custom: true,
          updated_by: commissioner.id, updated_at: "2026-08-02T00:00:00Z",
        }],
        error: null,
      };
    },
  };
  authDoubles(commissioner, admin);
  const response = await request("/api/workspace/labels/submission-1", {
    method: "PUT",
    body: { labels: [{ id: "catalog-1", catalogId: "catalog-1", name: "Custom Label 1", color: "cyan", custom: true }] },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body[0].id, "assignment-1");
  assert.equal(response.body[0].catalogId, "catalog-1");
  assert.equal(response.body[0].custom, true);
  assert.equal(rpcCalls[0].name, "set_submission_workspace_labels");

  const duplicate = await request("/api/workspace/labels/submission-1", {
    method: "PUT",
    body: {
      labels: [
        { catalogId: "catalog-1", name: "Custom Label 1", color: "cyan", custom: true },
        { catalogId: "catalog-1", name: "Custom Label 1", color: "cyan", custom: true },
      ],
    },
  });
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.body.error, /only be assigned once/i);
  assert.equal(rpcCalls.length, 1);
});

test("Workspace label reads do not consult the deprecated global catalog", async () => {
  const selectedColumns = [];
  const admin = {
    from(table) {
      if (table === "workspace_labels") {
        return {
          select(columns) { selectedColumns.push(columns); return this; },
          eq() { return this; },
          async order() {
            return {
              data: [{
                id: "legacy-assignment-1",
                submission_id: "submission-1",
                name: "Custom Cyan",
                color: "#26a69a",
                is_custom: true,
                updated_by: commissioner.id,
                updated_at: "2026-08-01T00:00:00Z",
              }],
              error: null,
            };
          },
        };
      }
      assert.fail(`Unexpected global catalog access: ${table}`);
    },
  };
  authDoubles(commissioner, admin);

  const response = await request("/api/workspace/labels/submission-1");
  assert.equal(response.status, 200);
  assert.equal(response.body[0].id, "legacy-assignment-1");
  assert.equal(response.body[0].catalogId, null);
  assert.equal(selectedColumns[0], "*");
});

test("a missing local Workspace label migration is reported as service unavailable, not a raw 500", async () => {
  const admin = {
    from(table) {
      if (table === "submissions") {
        return {
          select() { return this; }, eq() { return this; },
          async maybeSingle() { return { data: { id: "submission-1" }, error: null }; },
        };
      }
      assert.equal(table, "workspace_labels");
      return {
        insert() { return this; }, select() { return this; },
        async single() {
          return {
            data: null,
            error: { code: "42703", message: "column workspace_labels.is_selected does not exist" },
          };
        },
      };
    },
  };
  authDoubles(commissioner, admin);

  const response = await request("/api/workspace/label-catalog", {
    method: "POST",
    body: { submissionId: "submission-1", name: "Local", color: "#607d8b", custom: true },
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.error, "Workspace label migration is not installed.");
});

test("Commissioner CSV is authorized, formula-safe, and backed by the lightweight select", async () => {
  const capture = {};
  const rows = [{ ...submissionRows(1)[0], title: "=DANGEROUS", user_id: "public-1" }];
  authDoubles(commissioner, listAdmin(rows, capture));
  const response = await request("/api/exports/submissions.csv");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /commissioner-submissions\.csv/);
  assert.deepEqual([...response.raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(response.text.includes("'=DANGEROUS"));
  assert.equal(capture.submissionColumns.includes("geometry"), false);

  authDoubles(publicUser, listAdmin(rows));
  const forbidden = await request("/api/exports/submissions.csv");
  assert.equal(forbidden.status, 403);
});

test("Archived Tree JSON exports complete ordered snapshots and is Commissioner-only", async () => {
  const rows = [
    {
      id: "archive-2", branch_key: "branch-a", submission_id: "submission-1",
      version_number: 2, is_latest: true, submission_snapshot: { geometry: { type: "Polygon" } },
      closing_comment: { content: "done" }, merged_by: commissioner.id, merged_at: "2026-08-02T12:00:00Z",
    },
    {
      id: "archive-1", branch_key: "branch-a", submission_id: "submission-1",
      version_number: 1, is_latest: false, submission_snapshot: { geometry: { type: "Polygon" } },
      closing_comment: null, merged_by: commissioner.id, merged_at: "2026-08-01T12:00:00Z",
    },
  ];
  const admin = {
    from(table) {
      assert.equal(table, "archive_tree");
      let orderCalls = 0;
      return {
        select(columns) { assert.equal(columns, "*"); return this; },
        order() {
          orderCalls += 1;
          return orderCalls === 2 ? Promise.resolve({ data: rows, error: null }) : this;
        },
      };
    },
  };
  authDoubles(commissioner, admin);
  const response = await request("/api/exports/archive-tree.json");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /archived-tree\.json/);
  assert.equal(response.body.schemaVersion, 1);
  assert.equal(response.body.branches.length, 1);
  assert.equal(response.body.branches[0].versions.length, 2);
  assert.equal(response.body.branches[0].versions[0].submissionSnapshot.geometry.type, "Polygon");

  authDoubles(publicUser, admin);
  const forbidden = await request("/api/exports/archive-tree.json");
  assert.equal(forbidden.status, 403);
});

test("Workspace comments and custom catalog labels support stable authenticated CRUD", async () => {
  const admin = collaborationAdmin();
  authDoubles(commissioner, admin);

  const createdComment = await request("/api/workspace/comments", {
    method: "POST",
    body: { submissionId: "submission-1", content: " First comment " },
  });
  assert.equal(createdComment.status, 201);
  assert.equal(createdComment.body.content, "First comment");
  assert.ok(createdComment.body.id);

  admin.state.workspace_comments[0].profiles = { email: commissioner.email };
  const comments = await request("/api/workspace/comments/submission-1");
  assert.equal(comments.status, 200);
  assert.equal(comments.body.length, 1);
  assert.equal(comments.body[0].id, createdComment.body.id);

  const updatedComment = await request(`/api/workspace/comments/${createdComment.body.id}`, {
    method: "PATCH",
    body: { content: "Updated comment" },
  });
  assert.equal(updatedComment.status, 200);
  assert.equal(updatedComment.body.content, "Updated comment");

  const deletedComment = await request(`/api/workspace/comments/${createdComment.body.id}`, { method: "DELETE" });
  assert.equal(deletedComment.status, 200);
  assert.equal(admin.state.workspace_comments.length, 0);

  const createdCatalog = await request("/api/workspace/label-catalog", {
    method: "POST",
    body: { submissionId: "submission-1", name: "Custom Label 4", color: "#607d8b", custom: true },
  });
  assert.equal(createdCatalog.status, 201);
  assert.equal(createdCatalog.body.custom, true);
  assert.equal(createdCatalog.body.createdBy, commissioner.id);

  const updatedCatalog = await request(`/api/workspace/label-catalog/${createdCatalog.body.id}`, {
    method: "PATCH",
    body: { submissionId: "submission-1", name: "Priority Review", color: "#112233" },
  });
  assert.equal(updatedCatalog.status, 200);
  assert.equal(updatedCatalog.body.name, "Priority Review");
  assert.equal(updatedCatalog.body.color, "#112233");

  const deletedCatalog = await request(`/api/workspace/label-catalog/${createdCatalog.body.id}?submissionId=submission-1`, { method: "DELETE" });
  assert.equal(deletedCatalog.status, 200);
  assert.equal(admin.state.workspace_labels.length, 0);

  const removedLegacyWrite = await request("/api/workspace/labels/submission-1", {
    method: "POST",
    body: { labels: [] },
  });
  assert.equal(removedLegacyWrite.status, 404);
});

test("custom Workspace label candidates are isolated to their submission", async () => {
  const admin = collaborationAdmin({
    submissions: [{ id: "submission-1" }, { id: "submission-2" }],
    workspace_labels: [
      {
        id: "local-1", submission_id: "submission-1", name: "Testing",
        color: "#0891b2", is_custom: true, is_selected: false,
        updated_by: commissioner.id, updated_at: "2026-08-02T12:00:00.000Z",
      },
      {
        id: "local-2", submission_id: "submission-2", name: "Second only",
        color: "#607d8b", is_custom: true, is_selected: false,
        updated_by: commissioner.id, updated_at: "2026-08-02T12:01:00.000Z",
      },
    ],
  });
  authDoubles(commissioner, admin);

  const first = await request("/api/workspace/label-catalog?submissionId=submission-1");
  const second = await request("/api/workspace/label-catalog?submissionId=submission-2");

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.some((label) => label.name === "Testing"), true);
  assert.equal(first.body.some((label) => label.name === "Second only"), false);
  assert.equal(second.body.some((label) => label.name === "Testing"), false);
  assert.equal(second.body.some((label) => label.name === "Second only"), true);
});

test("Workspace collaboration endpoints reject Public users", async () => {
  const admin = collaborationAdmin();
  authDoubles(publicUser, admin);
  const response = await request("/api/workspace/comments/submission-1");
  assert.equal(response.status, 403);
});
