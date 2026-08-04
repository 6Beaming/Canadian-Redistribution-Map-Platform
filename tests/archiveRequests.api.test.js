import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";
import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";
import { setResourceScopeTestDoubles } from "../server/lib/authorization/resourceScopeGuard.js";

const COOKIE = "crmp_access_token=access-token";
const requester = {
  id: "commissioner-mb-1",
  email: "mb1@example.com",
  role: "commissioner",
  province: "MB",
};
const assignee = {
  id: "commissioner-mb-2",
  email: "mb2@example.com",
  role: "commissioner",
  province: "MB",
};

afterEach(() => {
  setSupabaseTestDoubles(null);
  setResourceScopeTestDoubles(null);
});

async function request(path, { method = "GET", body, cookie = COOKIE, profile = requester } = {}) {
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
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeAdmin() {
  const state = {
    submissions: [{
      id: "submission-1",
      type: "feedback",
      status: "accepted",
      dguid: "2021S051246050041",
      neighboring_dguid: null,
      resource_version: 1,
      active_claim_pruid: null,
      active_claim_kind: null,
      user_id: "public-1",
      updated_at: "2026-08-03T12:00:00.000Z",
    }],
    submission_scope_pruids: [{ submission_id: "submission-1", pruid: "46" }],
    profiles: [requester, assignee],
    counter_proposal_revisions: [],
    archive_source_revisions: [],
    workspace_archive_requests: [],
    workspace_archive_request_votes: [],
    realtime_outbox: [],
    realtime_scope_deliveries: [],
  };
  let seq = 1;

  function rows(table, filters = []) {
    return (state[table] ?? []).filter((row) =>
      filters.every(([op, field, value]) => {
        if (op === "eq") return String(row[field]) === String(value);
        if (op === "in") return value.map(String).includes(String(row[field]));
        return true;
      }));
  }

  return {
    state,
    from(table) {
      let operation = "read";
      let values = null;
      const filters = [];
      let orFilter = null;
      let orderField = null;
      let orderAsc = true;
      let limitCount = null;

      const builder = {
        select() { return this; },
        insert(input) {
          operation = "insert";
          values = Array.isArray(input) ? input : [input];
          return this;
        },
        update(input) {
          operation = "update";
          values = input;
          return this;
        },
        upsert(input) {
          operation = "upsert";
          values = Array.isArray(input) ? input : [input];
          return this;
        },
        delete() {
          operation = "delete";
          return this;
        },
        eq(field, value) { filters.push(["eq", field, value]); return this; },
        in(field, value) { filters.push(["in", field, value]); return this; },
        or(expression) { orFilter = expression; return this; },
        order(field, opts = {}) {
          orderField = field;
          orderAsc = opts.ascending !== false;
          return this;
        },
        limit(count) { limitCount = count; return this; },
        async single() {
          const result = await this.maybeSingle();
          if (!result.data) return { data: null, error: { message: "not found" } };
          return result;
        },
        async maybeSingle() {
          const list = await this.then?.() ?? execute();
          return { data: list.data?.[0] ?? null, error: list.error };
        },
        then(resolve, reject) {
          return Promise.resolve().then(execute).then(resolve, reject);
        },
      };

      function applyOrder(list) {
        let next = [...list];
        if (orderField) {
          next.sort((left, right) => {
            const l = left[orderField];
            const r = right[orderField];
            if (l === r) return 0;
            return (l > r ? 1 : -1) * (orderAsc ? 1 : -1);
          });
        }
        if (limitCount !== null) next = next.slice(0, limitCount);
        return next;
      }

      function matchesClaim(row) {
        if (!orFilter) return true;
        const claim = row.active_claim_pruid;
        if (orFilter.includes("active_claim_pruid.is.null") && (claim == null || claim === "")) {
          return true;
        }
        const eqMatch = orFilter.match(/active_claim_pruid\.eq\.([0-9]+)/);
        return Boolean(eqMatch && String(claim) === eqMatch[1]);
      }

      function execute() {
        if (operation === "insert") {
          const created = values.map((value) => ({
            id: value.id ?? `${table}-${seq++}`,
            created_at: value.created_at ?? "2026-08-03T12:00:00.000Z",
            updated_at: value.updated_at ?? "2026-08-03T12:00:00.000Z",
            ...value,
          }));
          state[table].push(...created);
          return { data: created, error: null };
        }
        if (operation === "upsert") {
          for (const value of values) {
            const existing = state[table].find((row) =>
              String(row.request_id) === String(value.request_id)
              && String(row.voter_id) === String(value.voter_id));
            if (existing) Object.assign(existing, value);
            else {
              state[table].push({
                created_at: "2026-08-03T12:00:00.000Z",
                updated_at: "2026-08-03T12:00:00.000Z",
                ...value,
              });
            }
          }
          return { data: values, error: null };
        }
        let matched = rows(table, filters).filter(matchesClaim);
        if (operation === "update") {
          if (!matched[0]) return { data: [], error: null };
          Object.assign(matched[0], values);
          return { data: [matched[0]], error: null };
        }
        if (operation === "delete") {
          const remove = new Set(matched);
          state[table] = state[table].filter((row) => !remove.has(row));
          return { data: matched, error: null };
        }
        return { data: applyOrder(matched), error: null };
      }

      // Override maybeSingle to use execute properly
      builder.maybeSingle = async () => {
        const result = execute();
        const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
        return { data, error: result.error };
      };
      builder.single = async () => {
        const result = await builder.maybeSingle();
        if (!result.data) return { data: null, error: { message: "not found" } };
        return result;
      };
      builder.then = (resolve, reject) => Promise.resolve().then(execute).then(resolve, reject);

      return builder;
    },
  };
}

function auth(profile, admin) {
  setResourceScopeTestDoubles({
    getProfileForDguid: async () => ({ pruid: "46" }),
  });
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: profile }, error: null }) },
    }),
    getSupabaseProfile: async () => profile,
    getSupabaseAdminDataClient: () => admin,
  });
}

test("archive request create seals source, claims province, and writes outbox delivery", async () => {
  const admin = makeAdmin();
  auth(requester, admin);

  const response = await request("/api/workspace/archive-requests", {
    method: "POST",
    body: {
      submissionId: "submission-1",
      assignees: [assignee.email],
      expectedVersion: 1,
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.state, "open");
  assert.equal(response.body.operatingPruid, "46");
  assert.ok(response.body.sourceRevisionId);
  assert.equal(response.body.version, 1);
  assert.equal(admin.state.submissions[0].status, "archive-request");
  assert.equal(admin.state.submissions[0].active_claim_pruid, "46");
  assert.equal(admin.state.archive_source_revisions.length, 1);
  assert.equal(admin.state.realtime_outbox.length, 1);
  assert.equal(admin.state.realtime_scope_deliveries.length, 1);
  assert.equal(admin.state.realtime_scope_deliveries[0].pruid, "46");
  assert.equal(admin.state.workspace_archive_request_votes.length, 1);
});

test("counter-proposal Archive Request identifies its requester", async () => {
  const admin = makeAdmin();
  admin.state.submissions[0].type = "counter-proposal";
  admin.state.counter_proposal_revisions.push({
    id: "counter-revision-1",
    submission_id: "submission-1",
    revision_number: 1,
    primary_dguid: admin.state.submissions[0].dguid,
    secondary_dguid: null,
    baseline_revision: "baseline-1",
    original_geometry: {},
    proposed_geometry: {},
    shared_boundary: null,
    outer_boundary: {},
    validation_report: {},
  });
  auth(requester, admin);

  const response = await request("/api/workspace/archive-requests", {
    method: "POST",
    body: {
      submissionId: "submission-1",
      assignees: [assignee.email],
      expectedVersion: 1,
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.requesterEmail, requester.email);
  assert.ok(response.body.allowedActions.includes("cancel"));
  assert.equal(response.body.allowedActions.includes("merge"), false);
});

test("approved Archive Request keeps requester cancel and merge actions", async () => {
  const admin = makeAdmin();
  auth(requester, admin);
  const created = await request("/api/workspace/archive-requests", {
    method: "POST",
    body: {
      submissionId: "submission-1",
      assignees: [assignee.email],
      expectedVersion: 1,
    },
  });
  assert.equal(created.status, 201);

  auth(assignee, admin);
  const voted = await request(`/api/workspace/archive-requests/${created.body.id}/votes`, {
    method: "POST",
    body: { vote: "accepted", expectedVersion: 1 },
  });
  assert.equal(voted.status, 200);
  assert.equal(voted.body.state, "approved");

  auth(requester, admin);
  const loaded = await request("/api/workspace/archive-requests/submission-1");
  assert.equal(loaded.status, 200);
  assert.ok(loaded.body.allowedActions.includes("cancel"));
  assert.ok(loaded.body.allowedActions.includes("merge"));
});

test("archive request vote reject cancels claim and returns to accepted", async () => {
  const admin = makeAdmin();
  auth(requester, admin);
  const created = await request("/api/workspace/archive-requests", {
    method: "POST",
    body: {
      submissionId: "submission-1",
      assignees: [assignee.email],
      expectedVersion: 1,
    },
  });
  assert.equal(created.status, 201);

  auth(assignee, admin);
  const voted = await request(`/api/workspace/archive-requests/${created.body.id}/votes`, {
    method: "POST",
    body: { vote: "rejected", expectedVersion: 1 },
  });

  assert.equal(voted.status, 200);
  assert.equal(voted.body.state, "rejected");
  assert.equal(admin.state.submissions[0].status, "accepted");
  assert.equal(admin.state.submissions[0].active_claim_pruid, null);
});

test("unrelated province cannot create an archive request", async () => {
  const admin = makeAdmin();
  auth({ ...requester, id: "on-1", email: "on@example.com", province: "ON" }, admin);

  const response = await request("/api/workspace/archive-requests", {
    method: "POST",
    body: {
      submissionId: "submission-1",
      assignees: [assignee.email],
      expectedVersion: 1,
    },
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.code, "NOT_FOUND");
  assert.equal(admin.state.workspace_archive_requests.length, 0);
  assert.equal(admin.state.realtime_outbox.length, 0);
});
