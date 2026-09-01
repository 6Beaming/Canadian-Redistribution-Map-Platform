import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { afterEach, jest, test } from "@jest/globals";

import app from "../server/app.js";
import { prepareCounterProposalSubmission } from "../server/lib/map/counterProposalSubmission.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";
import { loadCurrentCanonicalRelease } from "../server/lib/map/canonicalReleaseStore.js";
import { clearMapReleaseGateCacheForTests } from "../server/lib/map/mapReleaseGate.js";
import {
  buildCounterProposalCache,
  previewCounterProposalHandleMove,
} from "../src/lib/map/counterProposalWorkflow.js";
import { buildDaObjectionIndex } from "../src/lib/map/objectionWorkflow.js";

jest.setTimeout(120000);

const yukonFedGeometry = JSON.parse(
  fs.readFileSync(
    new URL("../src/data/map/metadata/fed_60001.geojson", import.meta.url),
    "utf8",
  ),
);
const temporaryCounterProposalData = JSON.parse(
  fs.readFileSync(
    new URL("../src/data/map/temp.json", import.meta.url),
    "utf8",
  ),
);

const fixture = temporaryCounterProposalData.submissions[0];
const FIRST_DGUID = fixture.dguid;
const SECOND_DGUID = fixture.neighboring_dguid;

function buildEditedProposedGeometry() {
  const selectedFeatures = yukonFedGeometry.features.filter((feature) =>
    [FIRST_DGUID, SECOND_DGUID].includes(feature.properties?.DGUID),
  );
  const index = buildDaObjectionIndex({
    type: "FeatureCollection",
    features: selectedFeatures,
  });
  const cache = buildCounterProposalCache(index, new Map(), FIRST_DGUID, SECOND_DGUID);
  const handleId = fixture.geometry_edit.operations[0].handle_id;
  const nextCoordinate = fixture.geometry_edit.operations[0].requested_coordinate;
  const editedCache = previewCounterProposalHandleMove(cache, handleId, nextCoordinate);

  return {
    type: "FeatureCollection",
    features: editedCache.currentFeatures,
  };
}

afterEach(() => {
  setSupabaseTestDoubles(null);
  clearMapReleaseGateCacheForTests();
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
    getSupabaseAdminDataClient: () => ({
      from(table) {
        if (table === "submissions") {
          return createSubmissionStore();
        }

        if (table === "counter_proposal_revisions") {
          return createRevisionStore();
        }

        if (table === "submission_geometry_revisions") {
          return createGeometryRevisionStore();
        }

        if (table === "submission_geometry_operations") {
          return { insert: async (values) => ({ data: values, error: null }) };
        }

        if (table === "map_data_releases") {
          const manifest = loadCurrentCanonicalRelease().manifest;
          return {
            select() { return this; },
            eq() { return this; },
            maybeSingle: async () => ({
              data: {
                release_id: manifest.releaseId,
                geometry_revision: manifest.geometryRevision,
                manifest_sha256: manifest.manifestSha256,
                topology_revision: manifest.topologyRevision,
                normalization_version: manifest.normalizationVersion,
                vertex_schema_version: manifest.vertexSchemaVersion,
                lod_schema_version: manifest.lodSchemaVersion,
                state: "active",
              },
              error: null,
            }),
          };
        }

        if (table === "dissemination_areas") {
          return {
            upsert(values, options) {
              return Promise.resolve({
                data: values,
                error: null,
              });
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    }),
  });
}

function createSubmissionStore() {
  const rows = [];

  return {
    insert(payload) {
      const row = {
        id: "submission-1",
        ...payload[0],
      };
      rows.push(row);
      return {
        select() {
          return {
            single: async () => ({ data: row, error: null }),
          };
        },
      };
    },
    select() {
      return {
        eq() {
          return this;
        },
        order() {
          return {
            async then() { },
          };
        },
      };
    },
    delete() {
      return {
        eq: async () => ({ error: null }),
      };
    },
  };
}

function createRevisionStore() {
  return {
    insert(payload) {
      const row = {
        id: "revision-1",
        ...payload[0],
      };
      return {
        select() {
          return {
            single: async () => ({ data: row, error: null }),
          };
        },
      };
    },
  };
}

function createGeometryRevisionStore() {
  return {
    insert(payload) {
      const row = { id: "geometry-revision-1", ...payload };
      return {
        select() {
          return { single: async () => ({ data: row, error: null }) };
        },
      };
    },
  };
}

test("prepareCounterProposalSubmission validates adjacent Yukon fixture pair geometry", async () => {
  const prepared = await prepareCounterProposalSubmission({
    title: fixture.title,
    comment: fixture.comment,
    fed_num: fixture.fed_num,
    dguid: FIRST_DGUID,
    neighboring_dguid: SECOND_DGUID,
    proposed_geometry: buildEditedProposedGeometry(),
  });

  assert.equal(prepared.submission.type, "counter_proposal");
  assert.equal(prepared.revision.primary_dguid, FIRST_DGUID);
  assert.equal(prepared.revision.secondary_dguid, SECOND_DGUID);
  assert.equal(prepared.revision.proposed_geometry.features.length, 2);
  assert.equal(prepared.revision.validation_report.valid, true);
  assert.equal(prepared.revision.validation_report.impact_summary.version, 1);
  assert.equal(prepared.revision.validation_report.impact_summary.availability, "available");
});

test("counter-proposal writes require authentication", async () => {
  const response = await request("POST", "/api/submissions/counter-proposals", {
    body: { title: "Test", comment: "Test" },
  });

  assert.equal(response.status, 401);
});

test("counter-proposal writes require a public user", async () => {
  authenticate({
    id: "commissioner-1",
    email: "commissioner@example.com",
    role: "commissioner",
    first_name: "Casey",
    last_name: "Commissioner",
    province: "YT",
    postal_code: "Y1A 1A1",
    phone: "8675550100",
  });

  const response = await request("POST", "/api/submissions/counter-proposals", {
    body: { title: "Test", comment: "Test" },
    cookie: "crmp_access_token=access-token",
  });

  assert.equal(response.status, 403);
});

test("a public user can submit a validated counter-proposal", async () => {
  authenticate({
    id: "public-1",
    email: "public@example.com",
    role: "public_user",
    first_name: "Pat",
    last_name: "Public",
    province: "YT",
    postal_code: "Y1A 1A1",
    phone: "8675550101",
  });

  const response = await request("POST", "/api/submissions/counter-proposals", {
    cookie: "crmp_access_token=access-token",
    body: {
      title: fixture.title,
      comment: fixture.comment,
      fed_num: fixture.fed_num,
      dguid: FIRST_DGUID,
      neighboring_dguid: SECOND_DGUID,
      proposed_geometry: buildEditedProposedGeometry(),
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.type, "counter_proposal");
  assert.equal(response.body.revision.revision_number, 1);
  assert.equal(response.body.revision.primary_dguid, FIRST_DGUID);
  assert.equal(response.body.revision.validation_report.impact_summary.version, 1);
  assert.equal(response.body.geometry_revision.migration_state, "ready");
});
