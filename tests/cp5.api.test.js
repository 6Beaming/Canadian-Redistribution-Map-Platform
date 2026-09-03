import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";
import app from "../server/app.js";
import {
  filterAndSortSubmissionRows,
  normalizeSubmissionListFilters,
  normalizeSubmissionListPagination,
} from "../server/lib/submissions/submissionListQuery.js";
import { resetApiTestState } from "./helpers/resetApiTestState.js";
import { setResourceScopeTestDoubles } from "../server/lib/authorization/resourceScopeGuard.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";

const COOKIE = "crmp_access_token=access-token";
const commissioner = { id: "commissioner-1", email: "eric@example.com", role: "commissioner", province: "NL" };
const publicUser = {
  id: "public-1", email: "public@example.com", role: "public_user",
  first_name: "Public", last_name: "User", province: "NL", postal_code: "A1A 1A1", phone: "7095550100",
};

afterEach(() => {
  resetApiTestState();
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

function rpcSubmissionListPayload(rows, values, { userId = null } = {}) {
  const filters = normalizeSubmissionListFilters({
    query: values.p_query ?? "",
    createdFrom: values.p_created_from ?? "",
    createdTo: values.p_created_to ?? "",
    type: values.p_type ?? "",
    status: values.p_status ?? "",
    sort: values.p_sort ?? "",
  });
  let filtered = userId
    ? rows.filter((row) => String(row.user_id) === String(userId))
    : [...rows];
  filtered = filterAndSortSubmissionRows(filtered, filters);
  const { pageSize } = normalizeSubmissionListPagination({ pageSize: values.p_page_size });
  const items = filtered.slice(0, pageSize).map((row) => ({
    ...row,
    profile: { id: row.user_id, email: `${row.user_id}@example.com` },
    scope_pruids: ["10"],
  }));
  return {
    data: {
      items,
      page: {
        pageSize,
        nextCursor: filtered.length > pageSize
          ? { createdAt: items.at(-1).created_at, id: items.at(-1).id, title: items.at(-1).title }
          : null,
        hasMore: filtered.length > pageSize,
      },
    },
    error: null,
  };
}

function listAdmin(rows, capture = {}, workspaceLabels = []) {
  return {
    async rpc(name, values) {
      if (name === "list_commissioner_submission_rows_v2") {
        return rpcSubmissionListPayload(rows, values);
      }
      if (name === "list_my_submission_rows_v2") {
        return rpcSubmissionListPayload(rows, values, { userId: values.p_user_id });
      }
      throw new Error(`Unexpected rpc ${name}`);
    },
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
      if (table === "workspace_labels") {
        let filtered = [...workspaceLabels];
        return {
          select(columns) { capture.labelColumns = columns; return this; },
          in(field, values) {
            filtered = filtered.filter((row) => values.includes(String(row[field])));
            return this;
          },
          async order() { return { data: filtered, error: null }; },
        };
      }
      assert.equal(table, "submissions");
      let filtered = [...rows];
      const builder = {
        select(columns) { capture.submissionColumns = columns; return builder; },
        eq(field, value) { filtered = filtered.filter((row) => String(row[field]) === String(value)); return builder; },
        in(field, values) {
          const allowed = new Set(values.map((value) => String(value)));
          filtered = filtered.filter((row) => allowed.has(String(row[field])));
          return builder;
        },
        async order() { return { data: filtered, error: null }; },
        async maybeSingle() { return { data: filtered[0] ?? null, error: null }; },
        then(resolve, reject) {
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        },
      };
      return builder;
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
  const response = await request("/api/submissions?query=%20Submission%20%20&createdFrom=2026-08-01&createdTo=2026-08-02&sort=oldest&pageSize=100");
  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 70);
  assert.deepEqual(response.body.appliedFilters, {
    query: "Submission", createdFrom: "2026-08-01", createdTo: "2026-08-02",
    type: "", status: "", sort: "oldest",
  });
  assert.equal(Object.hasOwn(response.body.items[0], "geometry"), false);
  assert.equal(Object.hasOwn(response.body.items[0], "comment"), false);
  assert.equal(response.body.items[0].profile.email, "public-2@example.com");
  assert.ok(Buffer.byteLength(response.text) < 100_000);
  assert.equal(response.text.includes("mustNotLeak"), false);
});

test("Commissioner analytics aggregates list rows without loading the full table in the client", async () => {
  authDoubles(commissioner, listAdmin(submissionRows(12)));
  const response = await request("/api/submissions/analytics");
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 12);
  assert.equal(typeof response.body.byType.feedback, "number");
  assert.equal(typeof response.body.byStatus.pending, "number");
  assert.ok(Array.isArray(response.body.daily));
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
  assert.equal(rpcCalls[0].name, "checkpoint0_set_submission_workspace_labels");

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

test("Commissioner CSV is authorized, subset-filtered, tag-inclusive, and formula-safe", async () => {
  const capture = {};
  const rows = submissionRows(2).map((row, index) => ({
    ...row,
    title: index === 0 ? "=DANGEROUS" : "SHOULD-NOT-EXPORT",
    user_id: "public-1",
  }));
  const labels = [
    { submission_id: rows[0].id, name: "Constructive", is_selected: true },
    { submission_id: rows[0].id, name: "Follow Up", is_selected: true },
    { submission_id: rows[0].id, name: "Removed", is_selected: false },
    { submission_id: rows[1].id, name: "Excluded Tag", is_selected: true },
  ];
  const admin = listAdmin(rows, capture, labels);
  authDoubles(commissioner, admin);
  const response = await request("/api/exports/submissions.csv", {
    method: "POST",
    body: { submissionIds: [rows[0].id] },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /commissioner-submissions\.csv/);
  assert.deepEqual([...response.raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(response.text.includes("'=DANGEROUS"));
  assert.equal(response.text.includes("SHOULD-NOT-EXPORT"), false);
  assert.ok(response.text.includes("Constructive; Follow Up"));
  assert.equal(response.text.includes("Removed"), false);
  assert.equal(response.text.includes("Excluded Tag"), false);
  assert.equal(capture.submissionColumns.includes("geometry"), false);
  assert.equal(capture.labelColumns, "submission_id,name,is_selected,updated_at");

  authDoubles(publicUser, admin);
  const forbidden = await request("/api/exports/submissions.csv", {
    method: "POST",
    body: { submissionIds: [rows[0].id] },
  });
  assert.equal(forbidden.status, 403);
});

test("Archived Tree JSON exports complete ordered snapshots and is Commissioner-only", async () => {
  const branchId = "branch-a";
  const branch = {
    id: branchId,
    branch_key: "comment:statscan-da-2021-r1:2021S051260010118",
    submission_type: "comment",
    release_id: "statscan-da-2021-r1",
    primary_dguid: "2021S051260010118",
    secondary_dguid: null,
    head_version_id: "archive-2",
    head_version_number: 2,
    resource_version: 1,
    scope_pruids: ["10"],
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-02T12:00:00Z",
  };
  const versions = [
    {
      id: "archive-2",
      branch_id: branchId,
      version_number: 2,
      merge_sequence: 2,
      version_kind: "merge",
      submission_projection: {
        id: "submission-1",
        user_id: "public-1",
        title: "Later version",
        comment: "Updated comment",
        created_at: "2026-08-01T12:00:00Z",
      },
      geometry_digest: null,
      validation_report: null,
      closing_comment: { content: "done" },
      merged_by: commissioner.id,
      merged_at: "2026-08-02T12:00:00Z",
    },
    {
      id: "archive-1",
      branch_id: branchId,
      version_number: 1,
      merge_sequence: 1,
      version_kind: "merge",
      submission_projection: {
        id: "submission-1",
        user_id: "public-1",
        title: "Earlier version",
        comment: "Original comment",
        created_at: "2026-08-01T10:00:00Z",
      },
      geometry_digest: null,
      validation_report: null,
      closing_comment: null,
      merged_by: commissioner.id,
      merged_at: "2026-08-01T12:00:00Z",
    },
  ];
  const admin = {
    from(table) {
      if (table === "archive_branches") {
        const builder = {
          select(_columns, options) {
            if (options?.head) {
              return Promise.resolve({ count: 1, error: null });
            }
            return builder;
          },
          order() {
            return Promise.resolve({ data: [branch], error: null });
          },
        };
        return builder;
      }
      if (table === "archive_versions") {
        let filtered = versions;
        return {
          select(columns) {
            this.columns = columns;
            return this;
          },
          in(field, values) {
            filtered = versions.filter((row) => values.includes(String(row[field])));
            return this;
          },
          order() {
            return Promise.resolve({ data: filtered, error: null });
          },
        };
      }
      if (table === "archive_map_revisions") {
        return {
          select() { return this; },
          eq() { return this; },
          order() { return this; },
          limit() { return this; },
          maybeSingle() {
            return Promise.resolve({
              data: { sequence: 3, release_id: "statscan-da-2021-r1" },
              error: null,
            });
          },
        };
      }
      if (table === "archive_map_da_heads") {
        return {
          select() { return this; },
          eq() { return Promise.resolve({ data: [], error: null }); },
        };
      }
      if (table === "profiles") {
        return {
          select() { return this; },
          in(_field, ids) {
            return Promise.resolve({
              data: ids.map((id) => ({ id, email: `${id}@example.com` })),
              error: null,
            });
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  authDoubles(commissioner, admin);
  const response = await request("/api/exports/archive-tree.json");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /archived-tree\.json/);
  assert.equal(response.body.schemaVersion, "1.0");
  assert.equal(response.body.archiveMapRevision, 3);
  assert.equal(response.body.branches.length, 1);
  assert.equal(response.body.branches[0].versions.length, 2);
  assert.equal(response.body.branches[0].versions[0].submission.comment, "Original comment");
  assert.equal(response.body.branches[0].versions[1].submission.comment, "Updated comment");

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
