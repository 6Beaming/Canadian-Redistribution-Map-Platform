import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, jest, test } from "@jest/globals";
import {
  clearMaterializationReadCounterForTests,
  setMaterializationReadCounterForTests,
} from "../server/lib/map/materializationContext.js";
import {
  prepareCounterProposalSubmission,
  prepareCounterProposalSubmissionV2,
} from "../server/lib/map/counterProposalSubmission.js";
import { deriveCounterProposalOperations } from "../server/lib/map/geometryOperations.js";
import { clearCanonicalReleaseCacheForTests, loadCurrentCanonicalRelease } from "../server/lib/map/canonicalReleaseStore.js";
import { buildDaObjectionIndex } from "../src/lib/map/objectionWorkflow.js";
import { buildCounterProposalCache, previewCounterProposalHandleMove } from "../src/lib/map/counterProposalWorkflow.js";

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

let cachedV2SubmissionBody = null;

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

afterEach(() => {
  clearCanonicalReleaseCacheForTests();
  clearMaterializationReadCounterForTests();
});

test("prepareCounterProposalSubmissionV2 deduplicates exact DA and shared arc reads per request", async () => {
  const counts = {
    exactDa: new Map(),
    sharedArc: 0,
    pair: 0,
  };
  setMaterializationReadCounterForTests({
    recordExactDa(dguid) {
      const key = String(dguid);
      counts.exactDa.set(key, (counts.exactDa.get(key) ?? 0) + 1);
    },
    recordSharedArc() {
      counts.sharedArc += 1;
    },
    recordPair() {
      counts.pair += 1;
    },
  });

  const manifest = loadCurrentCanonicalRelease().manifest;
  const body = await buildV2SubmissionBody();
  await prepareCounterProposalSubmissionV2(body, manifest);

  assert.equal(counts.exactDa.get(FIRST_DGUID), 1);
  assert.equal(counts.exactDa.get(SECOND_DGUID), 1);
  assert.ok(counts.sharedArc <= 1);
  assert.ok(counts.pair <= 2);
});
