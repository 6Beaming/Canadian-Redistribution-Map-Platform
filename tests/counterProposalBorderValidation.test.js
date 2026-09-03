import assert from "node:assert/strict";
import { test } from "@jest/globals";

import {
  buildCounterProposalCache,
  buildCounterProposalCacheFromReleasePair,
  buildFastDragOverlay,
  previewCounterProposalHandleMove,
} from "../src/lib/map/counterProposalWorkflow.js";
import {
  hasProperSegmentIntersection,
  hasValidAnchoredBoundarySegments,
  isBorderAnchor,
} from "../src/lib/map/counterProposalBorderValidation.js";
import { buildDaObjectionIndex } from "../src/lib/map/objectionWorkflow.js";

function createAdjacentPairCache() {
  const firstFeature = {
    type: "Feature",
    properties: { DGUID: "first", land_area: 1, population: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    },
  };
  const secondFeature = {
    type: "Feature",
    properties: { DGUID: "second", land_area: 1, population: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]],
    },
  };
  const index = buildDaObjectionIndex({
    type: "FeatureCollection",
    features: [firstFeature, secondFeature],
  });

  return buildCounterProposalCache(index, new Map(), "first", "second");
}

test("parametric segment intersection detects interior crossings only", () => {
  assert.equal(
    hasProperSegmentIntersection([0, 0], [2, 2], [0, 2], [2, 0]),
    true,
  );
  assert.equal(
    hasProperSegmentIntersection([0, 0], [1, 0], [1, 0], [1, 1]),
    false,
  );
});

test("shared-boundary interior handles are not border anchors", () => {
  const cache = createAdjacentPairCache();
  const handle = cache.handles.find(
    (entry) => entry.coordinate[0] === 1 && entry.coordinate[1] === 0.5,
  );

  assert.ok(handle);
  assert.equal(isBorderAnchor(cache, handle.coordinate, handle), false);
});

test("locked outer endpoints are border anchors", () => {
  const cache = createAdjacentPairCache();
  const handle = cache.handles.find(
    (entry) => entry.coordinate[0] === 1 && entry.coordinate[1] === 0.5,
  );
  const lockedEndpoint = cache.handles.find(
    (entry) => entry.locked && entry.coordinate[0] === 1 && entry.coordinate[1] === 0,
  );

  assert.ok(handle);
  assert.ok(lockedEndpoint);
  assert.equal(isBorderAnchor(cache, lockedEndpoint.coordinate, handle), true);
});

test("border-anchor validation rejects a sweep that crosses the original outer contour", () => {
  const cache = createAdjacentPairCache();
  const handle = cache.handles.find(
    (entry) => entry.coordinate[0] === 1 && entry.coordinate[1] === 0.5,
  );
  const nextCoordinate = [0, 0.5];
  const nextFeatures = cache.currentFeatures.map((feature) => {
    const clone = structuredClone(feature);
    handle.occurrences.forEach((occurrence) => {
      if (String(feature.properties?.DGUID) !== occurrence.featureDguid) {
        return;
      }

      const ring = clone.geometry.coordinates[occurrence.ringIndex];
      ring[occurrence.coordinateIndex] = [...nextCoordinate];
    });
    return clone;
  });

  assert.equal(
    hasValidAnchoredBoundarySegments(cache, handle, nextCoordinate, nextFeatures),
    false,
  );

  const nextCache = previewCounterProposalHandleMove(cache, handle.id, nextCoordinate);
  const movedHandle = nextCache.handles.find((entry) => entry.id === handle.id);

  assert.notDeepEqual(movedHandle?.coordinate, nextCoordinate);
});

test("border-anchor validation allows small interior moves along the shared boundary", () => {
  const cache = createAdjacentPairCache();
  const handle = cache.handles.find(
    (entry) => entry.coordinate[0] === 1 && entry.coordinate[1] === 0.5,
  );
  const nextCoordinate = [1, 0.55];
  const nextCache = previewCounterProposalHandleMove(cache, handle.id, nextCoordinate);
  const movedHandle = nextCache.handles.find((entry) => entry.id === handle.id);

  assert.deepEqual(movedHandle?.coordinate, nextCoordinate);
});

test("release pairs expose catalog interiors instead of inventing midpoint ids", () => {
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
    // Server edit handles now include unlocked catalog interiors even when a
    // display LOD collapsed the arc to endpoints.
    editableHandles: [
      { vertexId: "v0", coordinate: [0, 0], arcId: "arc-1", locked: true },
      { vertexId: "v1", coordinate: [0, 1], arcId: "arc-1", locked: false },
      { vertexId: "v2", coordinate: [0, 2], arcId: "arc-1", locked: true },
    ],
  };

  const cache = buildCounterProposalCacheFromReleasePair(payload, new Map(), "left", "right");

  assert.ok(cache.handles.length >= 3);
  assert.equal(cache.sourceBoundaryDensifications.length, 0);
  assert.ok(cache.handles.some((handle) => !handle.locked && handle.vertexId === "v1"));
  assert.equal(
    cache.handles.some((handle) => String(handle.vertexId ?? "").startsWith("release-midpoint-")),
    false,
  );
});

test("true endpoint-only release arcs gain an editable midpoint", () => {
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
  const payload = {
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
      { vertexId: "v1", coordinate: [0, 2], arcId: "arc-1", locked: true },
    ],
  };

  const cache = buildCounterProposalCacheFromReleasePair(payload, new Map(), "left", "right");

  assert.ok(cache.handles.some((handle) => !handle.locked));
  assert.ok(cache.sourceBoundaryDensifications.length >= 1);
  assert.ok(
    cache.handles.some((handle) => String(handle.vertexId ?? "").startsWith("release-midpoint-")),
  );
});

test("modified boundary segments cannot cross the original outline", () => {
  const cache = createAdjacentPairCache();
  const handle = cache.handles.find(
    (entry) => entry.coordinate[0] === 1 && entry.coordinate[1] === 0.5,
  );
  const nextCoordinate = [0, 0.5];
  const nextCache = previewCounterProposalHandleMove(cache, handle.id, nextCoordinate);
  const movedHandle = nextCache.handles.find((entry) => entry.id === handle.id);

  assert.notDeepEqual(movedHandle?.coordinate, nextCoordinate);
});

test("shared-boundary corner moves still respect third-da exterior edges", () => {
  const firstFeature = {
    type: "Feature",
    properties: { DGUID: "first", land_area: 1, population: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[-1, 0], [0, 0], [0, 1], [-1, 1], [-1, 0]]],
    },
  };
  const secondFeature = {
    type: "Feature",
    properties: { DGUID: "second", land_area: 1, population: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    },
  };
  const index = buildDaObjectionIndex({
    type: "FeatureCollection",
    features: [firstFeature, secondFeature],
  });
  const cache = buildCounterProposalCache(index, new Map(), "first", "second");
  const handle = {
    coordinate: [0, 1],
    occurrences: [{
      featureDguid: "second",
      polygonIndex: 0,
      ringIndex: 0,
      coordinateIndex: 3,
    }],
  };
  const nextCoordinate = [0.35, 0.75];
  const nextFeatures = cache.currentFeatures.map((feature) => {
    const clone = structuredClone(feature);
    handle.occurrences.forEach((occurrence) => {
      if (String(feature.properties?.DGUID) !== occurrence.featureDguid) {
        return;
      }

      const ring = clone.geometry.coordinates[occurrence.ringIndex];
      ring[occurrence.coordinateIndex] = [...nextCoordinate];
      ring[0] = [...nextCoordinate];
    });
    return clone;
  });

  assert.equal(
    hasValidAnchoredBoundarySegments(cache, handle, nextCoordinate, nextFeatures),
    false,
  );
});

test("release catalog interior handles move their boundary segments", () => {
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
  const interior = cache.handles.find((handle) => !handle.locked && handle.vertexId === "v1");

  assert.ok(interior);
  const nextCoordinate = [interior.coordinate[0], interior.coordinate[1] + 0.05];
  const nextCache = previewCounterProposalHandleMove(cache, interior.id, nextCoordinate);
  const movedHandle = nextCache.handles.find((entry) => entry.id === interior.id);

  assert.deepEqual(movedHandle?.coordinate, nextCoordinate);
});

test("fast drag overlay follows raw mouse without validation", () => {
  const cache = createAdjacentPairCache();
  const handle = cache.handles.find(
    (entry) => entry.coordinate[0] === 1 && entry.coordinate[1] === 0.5,
  );
  const rawCoordinate = [1.12, 0.62];
  const overlay = buildFastDragOverlay(cache, handle.id, rawCoordinate);

  assert.ok(handle);
  assert.ok(overlay);
  assert.deepEqual(overlay.coordinate, rawCoordinate);
  assert.ok(overlay.overlaySegments.length >= 1);
});

test("modified segments cannot cross other shared-boundary sections", () => {
  const firstFeature = {
    type: "Feature",
    properties: { DGUID: "first", land_area: 1, population: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    },
  };
  const secondFeature = {
    type: "Feature",
    properties: { DGUID: "second", land_area: 1, population: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]],
    },
  };
  const index = buildDaObjectionIndex({
    type: "FeatureCollection",
    features: [firstFeature, secondFeature],
  });
  const cache = buildCounterProposalCache(index, new Map(), "first", "second");
  const handle = cache.handles.find(
    (entry) => entry.coordinate[0] === 2 && entry.coordinate[1] === 0.5,
  );
  const nextCoordinate = [2, 1.5];

  assert.ok(handle);
  const nextCache = previewCounterProposalHandleMove(cache, handle.id, nextCoordinate);
  const movedHandle = nextCache.handles.find((entry) => entry.id === handle.id);

  assert.notDeepEqual(movedHandle?.coordinate, nextCoordinate);
});
