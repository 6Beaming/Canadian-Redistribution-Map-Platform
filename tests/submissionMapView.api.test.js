import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";
import app from "../server/app.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";

const COOKIE = "crmp_access_token=test-access-token";
const PUBLIC_USER = {
  id: "public-1",
  email: "owner@example.com",
  role: "public_user",
  first_name: "Public",
  last_name: "Owner",
  province: "YT",
  postal_code: "Y1A 1A1",
  phone: "8675550101",
};

const submissions = [
  {
    id: "comment-1",
    user_id: PUBLIC_USER.id,
    type: "feedback",
    title: "Comment title",
    comment: "Comment body",
    status: "pending",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-02T00:00:00.000Z",
    fed_num: "60001",
    dguid: "2021S051260010251",
    neighboring_dguid: null,
    geometry: { secret: true },
  },
  {
    id: "objection-1",
    user_id: PUBLIC_USER.id,
    type: "objection",
    title: "Objection title",
    comment: "Objection body",
    status: "accepted",
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-04T00:00:00.000Z",
    fed_num: "60001",
    dguid: "2021S051260010251",
    neighboring_dguid: "2021S051260010269",
  },
  {
    id: "counter-1",
    user_id: PUBLIC_USER.id,
    type: "counter_proposal",
    title: "Counter title",
    comment: "Counter body",
    status: "pending",
    created_at: "2026-08-05T00:00:00.000Z",
    updated_at: "2026-08-06T00:00:00.000Z",
    fed_num: "60001",
    dguid: "2021S051260010251",
    neighboring_dguid: "2021S051260010269",
  },
  {
    id: "other-owner",
    user_id: "public-2",
    type: "feedback",
    title: "Private title",
    comment: "Private body",
    status: "pending",
    created_at: "2026-08-07T00:00:00.000Z",
    updated_at: "2026-08-07T00:00:00.000Z",
    fed_num: "60001",
    dguid: "2021S051260010251",
    neighboring_dguid: null,
  },
];

const revisions = [{
  id: "revision-1",
  submission_id: "counter-1",
  revision_number: 2,
  primary_dguid: "2021S051260010251",
  secondary_dguid: "2021S051260010269",
  baseline_revision: "release-2026-08",
  validation_report: {
    impact_summary: { availability: "available", population_delta: 12 },
    operations: [{ vertexId: "v-1", coordinate: [-135, 60] }],
  },
  original_geometry: { secret: "exact base" },
  proposed_geometry: { secret: "exact proposal" },
}];

function createMaybeSingleQuery(rows, selectedColumns) {
  const filters = [];
  let limit = null;
  return {
    eq(column, value) {
      filters.push([column, value]);
      return this;
    },
    order() {
      return this;
    },
    limit(value) {
      limit = value;
      return this;
    },
    async maybeSingle() {
      let matches = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
      if (limit) matches = matches.slice(0, limit);
      return { data: matches[0] ?? null, error: null, selectedColumns };
    },
  };
}

function authenticate(profile = PUBLIC_USER) {
  const selects = [];
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
    getSupabaseAdminDataClient: () => ({
      from(table) {
        const rows = table === "submissions"
          ? submissions
          : table === "counter_proposal_revisions"
            ? revisions
            : [];
        return {
          select(columns) {
            selects.push({ table, columns });
            return createMaybeSingleQuery(rows, columns);
          },
        };
      },
    }),
  });
  return selects;
}

async function request(path, { cookie = COOKIE } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: cookie ? { cookie } : {},
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

afterEach(() => setSupabaseTestDoubles(null));

test("submission map view requires authentication", async () => {
  const response = await request("/api/submissions/comment-1/map-view", { cookie: "" });
  assert.equal(response.status, 401);
});

test("submission map view is public-user only", async () => {
  authenticate({ ...PUBLIC_USER, role: "commissioner" });
  const response = await request("/api/submissions/comment-1/map-view");
  assert.equal(response.status, 403);
});

test("non-owned and missing submissions both return 404", async () => {
  authenticate();
  const nonOwned = await request("/api/submissions/other-owner/map-view");
  const missing = await request("/api/submissions/missing/map-view");
  assert.equal(nonOwned.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(nonOwned.body, missing.body);
});

test.each([
  ["comment-1", "feedback", null],
  ["objection-1", "objection", "2021S051260010269"],
])("map-view returns a geometry-free projection for %s", async (id, type, secondaryDguid) => {
  const selects = authenticate();
  const response = await request(`/api/submissions/${id}/map-view`);

  assert.equal(response.status, 200);
  assert.equal(response.body.submission.type, type);
  assert.equal(response.body.submission.author.email, PUBLIC_USER.email);
  assert.equal(response.body.map.secondaryDguid, secondaryDguid);
  assert.equal(response.body.map.geometryRevisionId, null);
  assert.equal(Object.hasOwn(response.body.submission, "geometry"), false);
  assert.equal(Object.hasOwn(response.body.map, "originalGeometry"), false);
  assert.equal(Object.hasOwn(response.body.map, "proposedGeometry"), false);
  assert.equal(selects.some(({ columns }) => /(^|,)geometry(,|$)/.test(columns)), false);
});

test("counter-proposal map-view returns only its descriptor, sparse operations and impact", async () => {
  const selects = authenticate();
  const response = await request("/api/submissions/counter-1/map-view");

  assert.equal(response.status, 200);
  assert.equal(response.body.submission.type, "counter-proposal");
  assert.equal(response.body.map.releaseId, "release-2026-08");
  assert.equal(response.body.map.geometryRevisionId, "revision-1");
  assert.equal(
    JSON.stringify(response.body.map.operations),
    JSON.stringify(revisions[0].validation_report.operations),
  );
  assert.equal(
    JSON.stringify(response.body.map.impactSummary),
    JSON.stringify(revisions[0].validation_report.impact_summary),
  );
  assert.equal(JSON.stringify(response.body).includes("exact proposal"), false);
  assert.equal(selects.some(({ columns }) => columns.includes("original_geometry")), false);
  assert.equal(selects.some(({ columns }) => columns.includes("proposed_geometry")), false);
});

test("legacy counter-proposals without a geometry revision fail closed to a null descriptor", async () => {
  authenticate();
  revisions.splice(0, 1);
  try {
    const missingRevision = await request("/api/submissions/counter-1/map-view");
    assert.equal(missingRevision.status, 200);
    assert.equal(missingRevision.body.map.geometryRevisionId, null);
    assert.equal(missingRevision.body.map.operations.length, 0);
  } finally {
    revisions.push({
      id: "revision-1",
      submission_id: "counter-1",
      revision_number: 2,
      primary_dguid: "2021S051260010251",
      secondary_dguid: "2021S051260010269",
      baseline_revision: "release-2026-08",
      validation_report: {
        impact_summary: { availability: "available", population_delta: 12 },
        operations: [{ vertexId: "v-1", coordinate: [-135, 60] }],
      },
      original_geometry: { secret: "exact base" },
      proposed_geometry: { secret: "exact proposal" },
    });
  }
});
