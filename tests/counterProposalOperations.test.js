import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  buildBaseCoordinateMap,
  exportSubmissionOperations,
  initializeWorkerOperationState,
  rebuildDirtyOperations,
} from "../src/lib/map/counterProposalOperations.js";
import { buildCounterProposalCacheFromReleasePair } from "../src/lib/map/counterProposalWorkflow.js";
import {
  createCounterProposalWorkerState,
  processCounterProposalWorkerMessage,
} from "../src/lib/map/counterProposalWorkerDomain.js";

function buildFixtureCache() {
  const shared = [[0, 0], [0, 1], [0, 2]];
  const first = {
    type: "Feature",
    properties: { DGUID: "left" },
    geometry: { type: "Polygon", coordinates: [[[-1, 0], ...shared, [-1, 2], [-1, 0]]] },
  };
  const second = {
    type: "Feature",
    properties: { DGUID: "right" },
    geometry: { type: "Polygon", coordinates: [[[0, 2], [0, 1], [0, 0], [1, 0], [1, 2], [0, 2]]] },
  };
  return buildCounterProposalCacheFromReleasePair({
    releaseId: "statscan-da-2021-r1",
    baseRevision: "2021-r1",
    lod: "fine",
    features: { type: "FeatureCollection", features: [first, second] },
    sharedBoundary: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { arcId: "arc-1" },
        geometry: { type: "LineString", coordinates: shared },
      }],
    },
    editableHandles: [
      { vertexId: "v0", coordinate: [0, 0], arcId: "arc-1", locked: true },
      { vertexId: "v1", coordinate: [0, 1], arcId: "arc-1", locked: false },
      { vertexId: "v2", coordinate: [0, 2], arcId: "arc-1", locked: true },
    ],
  }, new Map(), "left", "right");
}

test("worker export returns deterministic sparse operations", () => {
  const cache = buildFixtureCache();
  const handle = cache.handles.find((entry) => !entry.locked);
  assert.ok(handle);
  const state = createCounterProposalWorkerState();
  processCounterProposalWorkerMessage(state, { type: "INIT", sequence: 1, cache });
  processCounterProposalWorkerMessage(state, {
    type: "COMMIT_MOVE",
    sequence: 2,
    handleId: handle.id,
    coordinate: [handle.coordinate[0], handle.coordinate[1] + 0.05],
  });
  const exported = processCounterProposalWorkerMessage(state, {
    type: "EXPORT_SUBMISSION_OPERATIONS",
    sequence: 3,
  });
  assert.equal(exported.type, "SUBMISSION_OPERATIONS_RESULT");
  assert.equal(exported.operations.length, 1);
  assert.equal(exported.operations[0].vertexId, "v1");
  assert.equal(exported.releaseId, "statscan-da-2021-r1");
});

test("endpoint-only arcs densify catalog interiors into the baseline and export them", () => {
  const shared = [[0, 0], [0, 2]];
  const first = {
    type: "Feature",
    properties: { DGUID: "left" },
    geometry: { type: "Polygon", coordinates: [[[-1, 0], [0, 0], [0, 2], [-1, 2], [-1, 0]]] },
  };
  const second = {
    type: "Feature",
    properties: { DGUID: "right" },
    geometry: { type: "Polygon", coordinates: [[[0, 2], [0, 0], [1, 0], [1, 2], [0, 2]]] },
  };
  const cache = buildCounterProposalCacheFromReleasePair({
    releaseId: "statscan-da-2021-r1",
    baseRevision: "2021-r1",
    lod: "coarse",
    features: { type: "FeatureCollection", features: [first, second] },
    sharedBoundary: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { arcId: "arc-1" },
        geometry: { type: "LineString", coordinates: shared },
      }],
    },
    editableHandles: [
      { vertexId: "v0", coordinate: [0, 0], arcId: "arc-1", locked: true },
      { vertexId: "v1", coordinate: [0, 0.4], arcId: "arc-1", locked: false },
      { vertexId: "v2", coordinate: [0, 2], arcId: "arc-1", locked: true },
    ],
  }, new Map(), "left", "right");
  const handle = cache.handles.find((entry) => !entry.locked && entry.vertexId === "v1");
  assert.ok(handle);
  assert.ok(cache.sourceBoundaryDensifications.length >= 1);
  const base = buildBaseCoordinateMap(cache).get("v1");
  assert.ok(base);
  assert.equal(Number(base[1]).toFixed(1), "0.4");

  const state = createCounterProposalWorkerState();
  processCounterProposalWorkerMessage(state, { type: "INIT", sequence: 1, cache });
  const committed = processCounterProposalWorkerMessage(state, {
    type: "COMMIT_MOVE",
    sequence: 2,
    handleId: handle.id,
    coordinate: [handle.coordinate[0] + 0.01, handle.coordinate[1]],
  });
  assert.equal(committed.valid, true);
  const exported = processCounterProposalWorkerMessage(state, {
    type: "EXPORT_SUBMISSION_OPERATIONS",
    sequence: 3,
  });
  assert.equal(exported.operations.length, 1);
  assert.equal(exported.operations[0].vertexId, "v1");
});

test("history still exports when the handle coordinate was not updated", () => {
  const cache = buildFixtureCache();
  const handle = cache.handles.find((entry) => !entry.locked);
  const base = [...handle.coordinate];
  const moved = [handle.coordinate[0], handle.coordinate[1] + 0.05];
  cache.history = [{
    type: "move-handle",
    handleId: handle.id,
    from: base,
    to: moved,
  }];
  const state = initializeWorkerOperationState(cache);
  const exported = exportSubmissionOperations(state, cache);
  assert.equal(exported.operations.length, 1);
  assert.equal(exported.operations[0].vertexId, "v1");
});

test("synthetic midpoint maps onto the nearest catalog vertex", () => {
  const cache = buildFixtureCache();
  const catalog = cache.handles.find((entry) => entry.vertexId === "v1");
  cache.catalogVertices = cache.handles.map((entry) => ({
    vertexId: entry.vertexId,
    coordinate: [...entry.coordinate],
    locked: entry.locked,
    arcId: entry.arcId,
  }));
  const synthetic = {
    ...catalog,
    id: "release:release-midpoint-arc-1-0",
    vertexId: "release-midpoint-arc-1-0",
    coordinate: [0, 0.9],
  };
  cache.handles = cache.handles.map((entry) => (
    entry.vertexId === "v1" ? synthetic : entry
  ));
  cache.history = [{
    type: "move-handle",
    handleId: synthetic.id,
    from: [0, 1],
    to: [0.02, 0.9],
  }];
  const state = initializeWorkerOperationState(cache);
  const exported = exportSubmissionOperations(state, cache);
  assert.equal(exported.operations.length, 1);
  assert.equal(exported.operations[0].vertexId, "v1");
});

test("rejected commits leave prior history and operations intact", () => {
  const cache = buildFixtureCache();
  const handle = cache.handles.find((entry) => !entry.locked);
  const state = createCounterProposalWorkerState();
  processCounterProposalWorkerMessage(state, { type: "INIT", sequence: 1, cache });
  const committed = processCounterProposalWorkerMessage(state, {
    type: "COMMIT_MOVE",
    sequence: 2,
    handleId: handle.id,
    coordinate: [handle.coordinate[0], handle.coordinate[1] + 0.05],
  });
  assert.equal(committed.valid, true);
  assert.equal(state.cache.history.length, 1);

  const rejected = processCounterProposalWorkerMessage(state, {
    type: "COMMIT_MOVE",
    sequence: 3,
    handleId: handle.id,
    coordinate: handle.coordinate,
  });
  assert.equal(rejected.valid, false);
  assert.equal(state.cache.history.length, 1);

  const exported = processCounterProposalWorkerMessage(state, {
    type: "EXPORT_SUBMISSION_OPERATIONS",
    sequence: 4,
  });
  assert.equal(exported.operations.length, 1);
  assert.equal(exported.operations[0].vertexId, "v1");
});

test("returning a vertex to base removes its operation", () => {
  const cache = buildFixtureCache();
  const handle = cache.handles.find((entry) => !entry.locked);
  const operationState = initializeWorkerOperationState(cache);
  const movedCoordinate = [handle.coordinate[0], handle.coordinate[1] + 0.05];
  handle.coordinate = movedCoordinate;
  let dirty = rebuildDirtyOperations(cache, operationState.baseCoordinateByVertexId);
  assert.equal(dirty.size, 1);
  handle.coordinate = [...operationState.baseCoordinateByVertexId.get("v1")];
  dirty = rebuildDirtyOperations(cache, operationState.baseCoordinateByVertexId);
  assert.equal(dirty.size, 0);
});

test("base coordinate map is built from original geometry", () => {
  const cache = buildFixtureCache();
  const baseMap = buildBaseCoordinateMap(cache);
  assert.equal(baseMap.get("v1")?.[1], 1);
  const exported = exportSubmissionOperations(initializeWorkerOperationState(cache), cache);
  assert.deepEqual(exported.operations, []);
});

test("Whitehorse 243/244 densified catalog vertex is in the baseline and exports", async () => {
  const { loadCurrentCanonicalRelease, readCanonicalDaPair } = await import(
    "../server/lib/map/canonicalReleaseStore.js"
  );
  const first = "2021S051260010243";
  const second = "2021S051260010244";
  const payload = await readCanonicalDaPair(loadCurrentCanonicalRelease(), first, second, {
    representation: "edit",
  });
  const cache = buildCounterProposalCacheFromReleasePair(payload, new Map(), first, second);
  const densifiedId = cache.sourceBoundaryDensifications.find((entry) => entry.vertexId)?.vertexId;
  const handle = cache.handles.find((entry) => (
    densifiedId ? entry.vertexId === densifiedId : !entry.locked
  ));
  assert.ok(handle);
  const base = buildBaseCoordinateMap(cache).get(handle.vertexId);
  assert.ok(base);
  const state = createCounterProposalWorkerState();
  processCounterProposalWorkerMessage(state, { type: "INIT", sequence: 1, cache });
  const committed = processCounterProposalWorkerMessage(state, {
    type: "COMMIT_MOVE",
    sequence: 2,
    handleId: handle.id,
    coordinate: [handle.coordinate[0] + 0.0002, handle.coordinate[1]],
  });
  assert.equal(committed.valid, true);
  const exported = processCounterProposalWorkerMessage(state, {
    type: "EXPORT_SUBMISSION_OPERATIONS",
    sequence: 3,
  });
  assert.ok(exported.operations.length >= 1);
  assert.equal(exported.operations[0].vertexId.startsWith("v1_"), true);
});
