import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { afterEach, jest, test } from "@jest/globals";

import app from "../server/app.js";
import { prepareCounterProposalSubmission, prepareCounterProposalSubmissionV2 } from "../server/lib/map/counterProposalSubmission.js";
import { deriveCounterProposalOperations } from "../server/lib/map/geometryOperations.js";
import { resetApiTestState } from "./helpers/resetApiTestState.js";
import { setSupabaseTestDoubles } from "../server/lib/supabase.js";
import { loadCurrentCanonicalRelease } from "../server/lib/map/canonicalReleaseStore.js";
import { clearMapReleaseGateCacheForTests } from "../server/lib/map/mapReleaseGate.js";
import {
  buildCounterProposalCache,
  previewCounterProposalHandleMove,
} from "../src/lib/map/counterProposalWorkflow.js";
import { buildDaObjectionIndex } from "../src/lib/map/objectionWorkflow.js";

jest.setTimeout(300000);

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
let cachedV2SubmissionBody = null;

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
  resetApiTestState();
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
      rpc(name, args) {
        if (name === "create_counter_proposal_submission_v2") {
          return Promise.resolve({
            data: {
              submission: {
                id: "submission-v2-1",
                title: args.p_title,
                status: "pending",
                created_at: new Date().toISOString(),
                resource_version: 1,
                dguid: args.p_primary_dguid,
                neighboring_dguid: args.p_secondary_dguid,
                release_id: args.p_release_id,
              },
              geometry_revision: {
                id: "geometry-revision-v2-1",
                revision_number: 1,
                geometry_digest: args.p_geometry_digest,
                migration_state: "ready",
              },
            },
            error: null,
          });
        }
        throw new Error(`Unexpected rpc: ${name}`);
      },
      from(table) {
        if (table === "submissions") {
          return createSubmissionStore();
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
}, 360000);

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

test("legacy counter-proposal payloads without schemaVersion 2.0 are rejected", async () => {
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
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "COUNTER_PROPOSAL_V2_REQUIRED");
});

async function buildV2SubmissionBody() {
  if (cachedV2SubmissionBody) {
    return cachedV2SubmissionBody;
  }
  const proposedGeometry = buildEditedProposedGeometry();
  const prepared = await prepareCounterProposalSubmission({
    title: fixture.title,
    comment: fixture.comment,
    fed_num: fixture.fed_num,
    dguid: FIRST_DGUID,
    neighboring_dguid: SECOND_DGUID,
    proposed_geometry: proposedGeometry,
  });
  const compact = await deriveCounterProposalOperations({
    primaryDguid: prepared.revision.primary_dguid,
    secondaryDguid: prepared.revision.secondary_dguid,
    originalGeometry: prepared.revision.original_geometry,
    proposedGeometry: prepared.revision.proposed_geometry,
  });
  const manifest = loadCurrentCanonicalRelease().manifest;
  cachedV2SubmissionBody = {
    schemaVersion: "2.0",
    title: fixture.title,
    comment: fixture.comment,
    releaseId: manifest.releaseId,
    baseRevision: manifest.geometryRevision,
    primaryDguid: FIRST_DGUID,
    secondaryDguid: SECOND_DGUID,
    operations: compact.operations.map((operation) => ({
      vertexId: operation.vertex_id,
      toLng: operation.to_lng,
      toLat: operation.to_lat,
    })),
  };
  return cachedV2SubmissionBody;
}

test("prepareCounterProposalSubmissionV2 materializes the same validated pair as legacy GeoJSON", async () => {
  const manifest = loadCurrentCanonicalRelease().manifest;
  const body = await buildV2SubmissionBody();
  const prepared = await prepareCounterProposalSubmissionV2(body, manifest);
  assert.equal(prepared.compact.operations.length > 0, true);
  assert.equal(prepared.validationReport.valid, true);
  assert.equal(prepared.validationReport.impact_summary.version, 1);
}, 360000);

test("a public user can submit a validated counter-proposal v2 payload", async () => {
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
    body: await buildV2SubmissionBody(),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.schemaVersion, "2.0");
  assert.equal(response.body.submission.type, "counter-proposal");
  assert.equal(response.body.geometryRevision.operationCount > 0, true);
  assert.equal(Object.hasOwn(response.body.submission, "geometry"), false);
}, 360000);
