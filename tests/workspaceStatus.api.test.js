import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";

import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";
import { setResourceScopeTestDoubles } from "../server/lib/authorization/resourceScopeGuard.js";

const commissioner = {
  id: "commissioner-1",
  email: "commissioner@example.com",
  role: "commissioner",
  province: "MB",
};

afterEach(() => {
  setSupabaseTestDoubles(null);
  setResourceScopeTestDoubles(null);
});

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
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function authenticate(profile = commissioner) {
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: profile.id, email: profile.email } },
          error: null,
        }),
      },
    }),
    getSupabaseProfile: async () => profile,
  });
}

function statusAdmin(seedRows, scopeRows = []) {
  const state = {
    submissions: seedRows.map((row) => ({ ...row })),
    submission_scope_pruids: scopeRows.map((row) => ({ ...row })),
  };
  const writes = [];

  return {
    state,
    writes,
    from(table) {
      let operation = "read";
      let values = null;
      const filters = [];
      let orFilter = null;
      const builder = {
        select() {
          return this;
        },
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
        eq(field, value) {
          filters.push([field, value]);
          return this;
        },
        or(expression) {
          orFilter = expression;
          return this;
        },
        async maybeSingle() {
          const matches = () => state[table].filter((row) => {
            const eqOk = filters.every(([field, value]) => String(row[field]) === String(value));
            if (!eqOk) return false;
            if (!orFilter || table !== "submissions") return true;
            const claim = row.active_claim_pruid;
            if (orFilter.includes("active_claim_pruid.is.null") && (claim == null || claim === "")) {
              return true;
            }
            const eqMatch = orFilter.match(/active_claim_pruid\.eq\.([0-9]+)/);
            return Boolean(eqMatch && String(claim) === eqMatch[1]);
          });

          if (operation === "update") {
            writes.push({ table, filters: [...filters], values: { ...values }, orFilter });
            const rows = matches();
            if (!rows[0]) return { data: null, error: null };
            Object.assign(rows[0], values);
            return { data: { ...rows[0] }, error: null };
          }

          return { data: matches()[0] ? { ...matches()[0] } : null, error: null };
        },
        then(resolve, reject) {
          return Promise.resolve().then(async () => {
            if (operation === "insert") {
              state[table].push(...values.map((value) => ({ ...value })));
              return { data: values, error: null };
            }
            return { data: matches(), error: null };
          }).then(resolve, reject);
        },
      };

      function matches() {
        return state[table].filter((row) =>
          filters.every(([field, value]) => String(row[field]) === String(value)));
      }

      return builder;
    },
  };
}

function withAdmin(admin, profile = commissioner) {
  setSupabaseTestDoubles({
    getSupabaseClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: profile.id, email: profile.email } },
          error: null,
        }),
      },
    }),
    getSupabaseProfile: async () => profile,
    getSupabaseAdminDataClient: () => admin,
  });
}

test("workspace status reads require authentication", async () => {
  const response = await request(
    "GET",
    "/api/workspace/submissions/submission-1/status",
  );
  assert.equal(response.status, 401);
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

  const response = await request(
    "PATCH",
    "/api/workspace/submissions/submission-1/status",
    {
      body: { status: "accepted" },
      cookie: "crmp_access_token=access-token",
    },
  );

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "Commissioner access is required.");
});

test("GET returns committed status, version, and scope projection", async () => {
  const admin = statusAdmin(
    [{
      id: "submission-1",
      status: "pending",
      resource_version: 3,
      updated_at: "2026-08-03T12:00:00.000Z",
      dguid: "2021S051246050041",
      neighboring_dguid: "2021S051247010151",
      active_claim_pruid: null,
      active_claim_kind: null,
    }],
    [
      { submission_id: "submission-1", pruid: "46" },
      { submission_id: "submission-1", pruid: "47" },
    ],
  );
  withAdmin(admin);

  const response = await request(
    "GET",
    "/api/workspace/submissions/submission-1/status",
    { cookie: "crmp_access_token=access-token" },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.submissionId, "submission-1");
  assert.equal(response.body.status, "pending");
  assert.equal(response.body.version, 3);
  assert.equal(response.body.operatingPruid, "46");
  assert.equal(JSON.stringify(response.body.eligibilityPruids), JSON.stringify(["46", "47"]));
  assert.match(response.body.crossProvinceWarning, /Manitoba and Saskatchewan/);
});

test("unrelated province cannot discover a submission status", async () => {
  const admin = statusAdmin(
    [{
      id: "submission-1",
      status: "pending",
      resource_version: 1,
      updated_at: "2026-08-03T12:00:00.000Z",
      dguid: "2021S051246050041",
      neighboring_dguid: null,
      active_claim_pruid: null,
    }],
    [{ submission_id: "submission-1", pruid: "46" }],
  );
  withAdmin(admin, { ...commissioner, province: "ON" });

  const response = await request(
    "GET",
    "/api/workspace/submissions/submission-1/status",
    { cookie: "crmp_access_token=access-token" },
  );

  assert.equal(response.status, 404);
  assert.equal(response.body.code, "NOT_FOUND");
});

test("PATCH accepts accepted and rejected with version bump", async () => {
  const admin = statusAdmin(
    [{
      id: "submission-1",
      status: "pending",
      resource_version: 1,
      updated_at: "2026-08-03T12:00:00.000Z",
      dguid: "2021S051246050041",
      neighboring_dguid: null,
      active_claim_pruid: null,
      active_claim_kind: null,
    }],
    [{ submission_id: "submission-1", pruid: "46" }],
  );
  withAdmin(admin);

  const accepted = await request(
    "PATCH",
    "/api/workspace/submissions/submission-1/status",
    {
      body: { status: "accepted", expectedVersion: 1 },
      cookie: "crmp_access_token=access-token",
    },
  );

  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, "accepted");
  assert.equal(accepted.body.version, 2);
  assert.equal(admin.state.submissions[0].status, "accepted");
  assert.equal(admin.state.submissions[0].resource_version, 2);

  const rejected = await request(
    "PATCH",
    "/api/workspace/submissions/submission-1/status",
    {
      body: { status: "rejected", expectedVersion: 2 },
      cookie: "crmp_access_token=access-token",
    },
  );

  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.status, "rejected");
  assert.equal(rejected.body.version, 3);
});

test("PATCH rejects archive-owned statuses without writing", async () => {
  const admin = statusAdmin(
    [{
      id: "submission-1",
      status: "pending",
      resource_version: 1,
      updated_at: "2026-08-03T12:00:00.000Z",
      dguid: "2021S051246050041",
      neighboring_dguid: null,
      active_claim_pruid: null,
    }],
    [{ submission_id: "submission-1", pruid: "46" }],
  );
  withAdmin(admin);

  for (const status of ["archive-request", "archived"]) {
    const response = await request(
      "PATCH",
      "/api/workspace/submissions/submission-1/status",
      {
        body: { status },
        cookie: "crmp_access_token=access-token",
      },
    );
    assert.equal(response.status, 400, status);
    assert.equal(response.body.code, "ARCHIVE_OWNED_STATUS");
  }

  const pending = await request(
    "PATCH",
    "/api/workspace/submissions/submission-1/status",
    {
      body: { status: "pending" },
      cookie: "crmp_access_token=access-token",
    },
  );
  assert.equal(pending.status, 400);
  assert.equal(pending.body.code, "UNSUPPORTED_STATUS");

  assert.equal(admin.writes.length, 0);
  assert.equal(admin.state.submissions[0].status, "pending");
});

test("PATCH returns 409 when expectedVersion is stale", async () => {
  const admin = statusAdmin(
    [{
      id: "submission-1",
      status: "accepted",
      resource_version: 4,
      updated_at: "2026-08-03T12:00:00.000Z",
      dguid: "2021S051246050041",
      neighboring_dguid: null,
      active_claim_pruid: null,
    }],
    [{ submission_id: "submission-1", pruid: "46" }],
  );
  withAdmin(admin);

  const response = await request(
    "PATCH",
    "/api/workspace/submissions/submission-1/status",
    {
      body: { status: "rejected", expectedVersion: 3 },
      cookie: "crmp_access_token=access-token",
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "STALE_RESOURCE_VERSION");
  assert.equal(response.body.current.status, "accepted");
  assert.equal(response.body.current.version, 4);
  assert.equal(admin.writes.length, 0);
});

test("PATCH returns 409 when another province holds the active claim", async () => {
  const admin = statusAdmin(
    [{
      id: "submission-1",
      status: "pending",
      resource_version: 1,
      updated_at: "2026-08-03T12:00:00.000Z",
      dguid: "2021S051246050041",
      neighboring_dguid: "2021S051247010151",
      active_claim_pruid: "47",
      active_claim_kind: "archive-request",
    }],
    [
      { submission_id: "submission-1", pruid: "46" },
      { submission_id: "submission-1", pruid: "47" },
    ],
  );
  withAdmin(admin);

  const response = await request(
    "PATCH",
    "/api/workspace/submissions/submission-1/status",
    {
      body: { status: "accepted", expectedVersion: 1 },
      cookie: "crmp_access_token=access-token",
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "RESOURCE_ALREADY_CLAIMED");
  assert.equal(response.body.currentClaimPruid, "47");
  assert.equal(admin.state.submissions[0].status, "pending");
});
