import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

import {
  buildCounterProposalCache,
  previewCounterProposalHandleMove,
} from "../src/lib/map/counterProposalWorkflow.js";
import { buildDaObjectionIndex } from "../src/lib/map/objectionWorkflow.js";

const FIRST_DGUID = "2021S051247020124";
const SECOND_DGUID = "2021S051247020154";
const fedGeometry = JSON.parse(
  fs.readFileSync(
    new URL("../src/data/map/metadata/fed_47012.geojson", import.meta.url),
    "utf8",
  ),
);
const selectedFeatures = fedGeometry.features.filter((feature) =>
  [FIRST_DGUID, SECOND_DGUID].includes(feature.properties?.DGUID),
);

function createReportedPairCache() {
  const index = buildDaObjectionIndex({
    type: "FeatureCollection",
    features: selectedFeatures,
  });

  return buildCounterProposalCache(
    index,
    new Map(),
    FIRST_DGUID,
    SECOND_DGUID,
  );
}

function createSimpleAdjacentPairCache() {
  const firstFeature = {
    type: "Feature",
    properties: { DGUID: "first", land_area: 1, population: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 0.5], [1, 1], [0, 1], [0, 0]]],
    },
  };
  const secondFeature = {
    type: "Feature",
    properties: { DGUID: "second", land_area: 1, population: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.5], [1, 0]]],
    },
  };
  const index = buildDaObjectionIndex({
    type: "FeatureCollection",
    features: [firstFeature, secondFeature],
  });

  return buildCounterProposalCache(index, new Map(), "first", "second");
}

function getBoundaryEndpoints(boundaryGeoJson) {
  const verticesById = new Map();

  boundaryGeoJson.features.forEach((feature) => {
    const coordinates = feature.geometry?.coordinates ?? [];

    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const start = coordinates[index];
      const end = coordinates[index + 1];
      const startId = `${Number(start[0]).toFixed(6)},${Number(start[1]).toFixed(6)}`;
      const endId = `${Number(end[0]).toFixed(6)},${Number(end[1]).toFixed(6)}`;

      if (startId === endId) {
        continue;
      }

      for (const [id, coordinate] of [[startId, start], [endId, end]]) {
        const vertex = verticesById.get(id) ?? { coordinate, degree: 0, id };
        vertex.degree += 1;
        verticesById.set(id, vertex);
      }
    }
  });

  return Array.from(verticesById.values()).filter((vertex) => vertex.degree === 1);
}

test("counter-proposal handles can move when the selected DAs contain polygon holes", () => {
  const cache = createReportedPairCache();

  assert.equal(selectedFeatures.length, 2);
  assert.ok(cache?.handles.length > 0);

  const handle = cache.handles[Math.floor(cache.handles.length / 2)];
  const targetCoordinate = [handle.coordinate[0] + 0.001, handle.coordinate[1]];
  const nextCache = previewCounterProposalHandleMove(
    cache,
    handle.id,
    targetCoordinate,
  );
  const movedHandle = nextCache.handles.find((entry) => entry.id === handle.id);

  assert.notStrictEqual(nextCache, cache);
  assert.deepEqual(movedHandle?.coordinate, targetCoordinate);
  assert.notEqual(nextCache.impacts.byDguid[FIRST_DGUID].areaDelta, 0);
  assert.notEqual(nextCache.impacts.byDguid[SECOND_DGUID].areaDelta, 0);
});

test("counter-proposal endpoints are not exposed as draggable handles", () => {
  const cache = createReportedPairCache();
  const endpoints = getBoundaryEndpoints(cache.sharedBoundaryGeoJson);

  assert.equal(endpoints.length, 2);

  endpoints.forEach((endpoint) => {
    assert.equal(cache.handles.some((handle) => handle.id === endpoint.id), false);
  });

  const endpoint = endpoints[0];
  const attemptedMove = previewCounterProposalHandleMove(
    cache,
    endpoint.id,
    [endpoint.coordinate[0] + 0.001, endpoint.coordinate[1]],
  );

  assert.strictEqual(attemptedMove, cache);
});

test("counter-proposal constrains a handle before it creates a degenerate or overlapping edge", () => {
  const cache = createSimpleAdjacentPairCache();
  const handle = cache.handles.find(
    (entry) => entry.coordinate[0] === 1 && entry.coordinate[1] === 0.5,
  );

  assert.ok(handle);

  for (const invalidTarget of [[1, 0], [0, 0]]) {
    const nextCache = previewCounterProposalHandleMove(
      cache,
      handle.id,
      invalidTarget,
    );
    const movedHandle = nextCache.handles.find((entry) => entry.id === handle.id);

    assert.notStrictEqual(nextCache, cache);
    assert.notDeepEqual(movedHandle?.coordinate, invalidTarget);

    nextCache.currentFeatures.forEach((feature) => {
      feature.geometry.coordinates.forEach((ring) => {
        for (let index = 0; index < ring.length - 1; index += 1) {
          assert.notDeepEqual(ring[index], ring[index + 1]);
        }
      });
    });
  }
});
