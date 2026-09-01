import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";

import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";
import { DASHBOARD_AREA_SUBMISSION_COLUMNS } from "../server/lib/submissions/dashboardAreaQuery.js";

const cookie = "crmp_access_token=access-token";
const commissioner = {
  id: "commissioner-1",
  email: "commissioner@example.com",
  role: "commissioner",
  province: "YT",
};

const IN_SCOPE_DGUID = "2021S051260010118";
const ADJACENT_DGUID = "2021S051259570228";
const OUT_OF_SCOPE_DGUID = "2021S051210010165";

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

function dashboardAdmin(calls, targetDguid = IN_SCOPE_DGUID) {
  const fixtureRows = [
    {
      id: "primary-match",
      type: "feedback",
      title: "Primary",
      comment: "Visible primary content",
      user_id: "author-1",
      status: "pending",
      dguid: targetDguid,
      neighboring_dguid: null,
      scope_pruid: "60",
    },
    {
      id: "secondary-match",
      type: "objection",
      title: "Secondary",
      comment: "Visible secondary content",
      user_id: "author-1",
      status: "archive-request",
      dguid: "other-da",
      neighboring_dguid: targetDguid,
      scope_pruid: "60",
    },
    {
      id: "unrelated-dguid",
      type: "feedback",
      title: "Unrelated",
      comment: "Must remain server-side",
      user_id: "author-2",
      status: "pending",
      dguid: "unrelated-da",
      neighboring_dguid: null,
      scope_pruid: "60",
    },
    {
      id: "unauthorized-province",
      type: "counter-proposal",
      title: "Unauthorized",
      comment: "Must not leave the database",
      user_id: "author-3",
      status: "pending",
      dguid: targetDguid,
      neighboring_dguid: null,
      scope_pruid: "35",
    },
  ];

  return {
    from(table) {
      calls.tables.push(table);
      if (table === "submissions") {
        return {
          select(columns) { calls.submissionSelect = columns; return this; },
          or(filter) { calls.dguidFilter = filter; return this; },
          eq(column, value) { calls.scopeFilter = [column, value]; return this; },
          in(column, values) { calls.statusFilter = [column, values]; return this; },
          async order(column, options) {
            calls.order = [column, options];
            const [, scopePruid] = calls.scopeFilter;
            const data = fixtureRows
              .filter((row) => row.scope_pruid === scopePruid)
              .filter((row) => row.dguid === targetDguid || row.neighboring_dguid === targetDguid)
              .map(({ scope_pruid: _scopePruid, ...row }) => row);
            return { data, error: null };
          },
        };
      }
      if (table === "profiles") {
        return {
          select(columns) { calls.profileSelect = columns; return this; },
          async in(column, values) {
            calls.profileBatch = [column, values];
            return { data: [{ id: "author-1", email: "author@example.com" }], error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

test("Dashboard DGUID endpoint filters in the database and batches authors", async () => {
  const calls = { tables: [] };
  authenticate(commissioner, dashboardAdmin(calls));

  const response = await request(`/api/workspace/dashboard/areas/${IN_SCOPE_DGUID}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.selectedArea.relationship, "in_scope");
  assert.deepEqual(calls.dguidFilter, `dguid.eq.${IN_SCOPE_DGUID},neighboring_dguid.eq.${IN_SCOPE_DGUID}`);
  assert.deepEqual(calls.scopeFilter, ["submission_scope_pruids.pruid", "60"]);
  assert.deepEqual(calls.statusFilter, ["status", ["pending", "archive-request"]]);
  assert.deepEqual(calls.profileBatch, ["id", ["author-1"]]);
  assert.equal(calls.tables.filter((table) => table === "profiles").length, 1);
  assert.equal(response.body.submissions.length, 2);
  assert.equal(
    response.body.submissions.map((submission) => submission.id).join(","),
    "primary-match,secondary-match",
  );
  assert.equal(response.body.submissions[0].comment, "Visible primary content");
  assert.equal(response.body.submissions[0].author.id, "author-1");
  assert.equal(response.body.submissions[0].author.email, "author@example.com");
});

test("Dashboard DGUID endpoint skips submission queries outside commissioner scope", async () => {
  const calls = { tables: [] };
  authenticate(commissioner, {
    from(table) {
      calls.tables.push(table);
      throw new Error(`database must not be queried for ${table}`);
    },
  });

  const adjacent = await request(`/api/workspace/dashboard/areas/${ADJACENT_DGUID}`);
  assert.equal(adjacent.status, 200);
  assert.equal(adjacent.body.selectedArea.relationship, "adjacent_to_scope");
  assert.equal(adjacent.body.submissions.length, 0);
  assert.ok(adjacent.body.inScopeNeighbors.length > 0);

  const outOfScope = await request(`/api/workspace/dashboard/areas/${OUT_OF_SCOPE_DGUID}`);
  assert.equal(outOfScope.status, 200);
  assert.equal(outOfScope.body.selectedArea.relationship, "out_of_scope");
  assert.equal(outOfScope.body.submissions.length, 0);
  assert.equal((outOfScope.body.inScopeNeighbors ?? []).length, 0);
  assert.equal(calls.tables.length, 0);
});

test("Dashboard projection is isolated from generic lists and excludes geometry", () => {
  assert.match(DASHBOARD_AREA_SUBMISSION_COLUMNS, /comment/);
  assert.match(DASHBOARD_AREA_SUBMISSION_COLUMNS, /submission_scope_pruids!inner/);
  assert.doesNotMatch(DASHBOARD_AREA_SUBMISSION_COLUMNS, /geometry|revision|operation|validation/i);
});

test("Dashboard DGUID endpoint rejects invalid DGUID interpolation", async () => {
  authenticate(commissioner, { from() { throw new Error("database must not be queried"); } });
  const response = await request("/api/workspace/dashboard/areas/invalid%2Cfilter");
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_DGUID");
});

test("Dashboard DGUID endpoint remains Commissioner-only", async () => {
  authenticate({
    ...commissioner,
    role: "public_user",
    first_name: "Public",
    last_name: "User",
    postal_code: "Y1A 1A1",
    phone: "8675550100",
  });
  const response = await request(`/api/workspace/dashboard/areas/${IN_SCOPE_DGUID}`);
  assert.equal(response.status, 403);
  assert.equal(response.body.error, "Commissioner access is required.");
});
