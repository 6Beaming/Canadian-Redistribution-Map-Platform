import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

import {
  buildCounterProposalCache,
  previewCounterProposalHandleMove,
} from "../src/lib/map/counterProposalWorkflow.js";
import {
  buildDaObjectionIndex,
  getPairOuterBoundaryFeatureCollection,
} from "../src/lib/map/objectionWorkflow.js";

const FIRST_DGUID = "2021S051247020124";
const SECOND_DGUID = "2021S051247020154";
const fedGeometry = JSON.parse(
  fs.readFileSync(
    new URL("../src/data/map/metadata/fed_47012.geojson", import.meta.url),
    "utf8",
  ),
);
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

test("the large Yukon counter-proposal fixture produces a visible valid boundary change", () => {
  const fixture = temporaryCounterProposalData.submissions.find(
    (submission) => submission.id === "temp-counter-proposal-006",
  );
  assert.ok(fixture);

  const selected = yukonFedGeometry.features.filter((feature) =>
    [fixture.dguid, fixture.neighboring_dguid].includes(feature.properties?.DGUID),
  );
  const index = buildDaObjectionIndex({ type: "FeatureCollection", features: selected });
  const cache = buildCounterProposalCache(index, new Map(), fixture.dguid, fixture.neighboring_dguid);
  const operation = fixture.geometry_edit.operations[0];
  const nextCache = previewCounterProposalHandleMove(
    cache,
    operation.handle_id,
    operation.requested_coordinate,
  );
  const movedHandle = nextCache.handles.find((handle) => handle.id === operation.handle_id);

  assert.deepEqual(movedHandle?.coordinate, operation.requested_coordinate);
  assert.ok(Math.abs(nextCache.impacts.byDguid[fixture.dguid].areaDelta) > 4_000_000);
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

test("counter-proposal stops a node before it reaches an unrelated original boundary", () => {
  const cache = createSimpleAdjacentPairCache();
  const handle = cache.handles.find(
    (entry) => entry.coordinate[0] === 1 && entry.coordinate[1] === 0.5,
  );

  assert.ok(handle);

  const boundaryTarget = [0, 0.5];
  const nextCache = previewCounterProposalHandleMove(cache, handle.id, boundaryTarget);
  const movedHandle = nextCache.handles.find((entry) => entry.id === handle.id);

  assert.notStrictEqual(nextCache, cache);
  assert.notDeepEqual(movedHandle?.coordinate, boundaryTarget);
  assert.ok(Number(movedHandle?.coordinate[0]) > 0);
});

test("counter-proposal repairs one repeated non-closure ring vertex before editing", () => {
  const firstFeature = {
    type: "Feature",
    properties: { DGUID: "first", land_area: 1, population: 1 },
    geometry: {
      type: "Polygon",
      // The source ring touches its initial vertex again before closure.
      coordinates: [[[0, 0], [1, 0], [1, 0.5], [1, 1], [0, 1], [0, 0], [-0.2, 0.3], [0, 0]]],
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
  const cache = buildCounterProposalCache(index, new Map(), "first", "second");

  assert.equal(cache.sourceGeometryIssues.length, 0);
  assert.equal(cache.sourceGeometryRepairs.length, 1);
  assert.equal(cache.sourceGeometryRepairs[0].type, "remove-duplicate-ring-vertex");
  assert.equal(cache.handles.length, 1);

  const handle = cache.handles[0];
  const nextCache = previewCounterProposalHandleMove(
    cache,
    handle.id,
    [handle.coordinate[0] - 0.0001, handle.coordinate[1]],
  );

  assert.notStrictEqual(nextCache, cache);
});

test("exact pair outline keeps edges shared with unselected neighbours", () => {
  const rectangle = (dguid, left, right) => ({
    type: "Feature",
    properties: { DGUID: dguid },
    geometry: {
      type: "Polygon",
      coordinates: [[[left, 0], [right, 0], [right, 1], [left, 1], [left, 0]]],
    },
  });
  const index = buildDaObjectionIndex({
    type: "FeatureCollection",
    features: [
      rectangle("first", 0, 1),
      rectangle("second", 1, 2),
      rectangle("neighbour", 2, 3),
    ],
  });
  const outerBoundary = getPairOuterBoundaryFeatureCollection(index, ["first", "second"]);

  assert.equal(outerBoundary.features.length, 6);
  assert.equal(
    outerBoundary.features.some((feature) => {
      const [start, end] = feature.geometry.coordinates;
      return (
        (start[0] === 1 && end[0] === 1) ||
        (start[0] === 1 && start[1] === 0 && end[0] === 1 && end[1] === 1)
      );
    }),
    false,
  );
  assert.equal(
    outerBoundary.features.some((feature) => {
      const [start, end] = feature.geometry.coordinates;
      return (
        start[0] === 2 &&
        end[0] === 2 &&
        Math.min(start[1], end[1]) === 0 &&
        Math.max(start[1], end[1]) === 1
      );
    }),
    true,
  );
});
