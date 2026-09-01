import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { buildReleaseEditableHandles } from "../src/lib/map/counterProposalReleaseCache.js";
import { buildCounterProposalCacheFromReleasePair } from "../src/lib/map/counterProposalWorkflow.js";
import {
  createCounterProposalWorkerState,
  processCounterProposalWorkerMessage,
} from "../src/lib/map/counterProposalWorkerDomain.js";

test("release editable handles only scan handle coordinates from exact geometry", () => {
  const shared = [[0, 0], [0, 1], [0, 2]];
  const first = {
    type: "Feature",
    properties: { DGUID: "left" },
    geometry: { type: "Polygon", coordinates: [[[-1, 0], ...shared, [-1, 2], [-1, 0]]] },
  };
  const second = {
    type: "Feature",
    properties: { DGUID: "right" },
    geometry: { type: "Polygon", coordinates: [[[...shared.toReversed()], [1, 0], [1, 2], [0, 2]]] },
  };
  const payload = {
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
  };

  const cache = buildCounterProposalCacheFromReleasePair(payload, new Map(), "left", "right");
  assert.equal(cache.handles.length, 3);
  assert.equal(cache.handles[1].vertexId, "v1");
  assert.equal(cache.handles[1].locked, false);
  assert.equal(cache.releaseLod, "fine");
  assert.equal(cache.sourceBoundaryDensifications.length, 0);
});

test("release cache commit records undo history from geometry coordinates", () => {
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
  const payload = {
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
  };

  const cache = buildCounterProposalCacheFromReleasePair(payload, new Map(), "left", "right");
  const handle = cache.handles.find((entry) => !entry.locked);
  assert.ok(handle);
  assert.equal(handle.occurrences.length, 2);
  const coordinate = [handle.coordinate[0], handle.coordinate[1] + 0.05];
  const state = createCounterProposalWorkerState();
  processCounterProposalWorkerMessage(state, { type: "INIT", sequence: 1, cache });
  const committed = processCounterProposalWorkerMessage(state, {
    type: "COMMIT_MOVE",
    sequence: 2,
    handleId: handle.id,
    coordinate,
  });
  assert.equal(committed.cache.history.length, 1);
  const undone = processCounterProposalWorkerMessage(state, { type: "UNDO", sequence: 3 });
  assert.equal(undone.cache.history.length, 0);
  assert.equal(undone.cache.future.length, 1);
});

test("buildReleaseEditableHandles maps vertex ids and occurrences", () => {
  const handles = buildReleaseEditableHandles(
    [{ vertexId: "v1", coordinate: [1, 0.5], arcId: "a", locked: false }],
    [{
      type: "Feature",
      properties: { DGUID: "left" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [1, 0.5], [0, 1], [0, 0]]] },
    }, {
      type: "Feature",
      properties: { DGUID: "right" },
      geometry: { type: "Polygon", coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.5], [1, 0]]] },
    }],
  );

  assert.equal(handles.length, 1);
  assert.equal(handles[0].id, "release:v1");
  assert.equal(handles[0].occurrences.length, 2);
});
