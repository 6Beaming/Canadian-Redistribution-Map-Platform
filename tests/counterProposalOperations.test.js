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
