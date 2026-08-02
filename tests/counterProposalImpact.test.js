import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  calculateCounterProposalImpact,
  geometryAreaMeters,
} from "../src/lib/map/counterProposalImpact.js";
import { hydrateFromPersistedRevision } from "../src/services/tempCounterProposal.js";

function feature(dguid, ring, holes = []) {
  return {
    type: "Feature",
    properties: { DGUID: dguid },
    geometry: { type: "Polygon", coordinates: [ring, ...holes] },
  };
}

const left = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const right = [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]];
const leftSmaller = [[0, 0], [0.9, 0], [0.9, 1], [0, 1], [0, 0]];
const rightLarger = [[0.9, 0], [2, 0], [2, 1], [0.9, 1], [0.9, 0]];

test("shared impact calculation produces equal-and-opposite transfer semantics", () => {
  const result = calculateCounterProposalImpact({
    originalFeatures: [feature("left", left), feature("right", right)],
    proposedFeatures: [feature("left", leftSmaller), feature("right", rightLarger)],
    populationByDguid: { left: 1000, right: 2000 },
    firstDguid: "left",
    secondDguid: "right",
  });
  assert.equal(result.availability, "available");
  assert.equal(result.transfer.fromDguid, "left");
  assert.equal(result.transfer.toDguid, "right");
  assert.ok(result.transfer.amount > 0);
  assert.equal(result.byDguid.left.populationDelta, -result.byDguid.right.populationDelta);
});

test("legitimate zero and missing population are not conflated", () => {
  const unchanged = calculateCounterProposalImpact({
    originalFeatures: [feature("left", left), feature("right", right)],
    proposedFeatures: [feature("left", left), feature("right", right)],
    populationByDguid: { left: 0, right: null },
    firstDguid: "left",
    secondDguid: "right",
  });
  assert.equal(unchanged.byDguid.left.population, 0);
  assert.equal(unchanged.byDguid.left.populationDelta, 0);
  assert.equal(unchanged.byDguid.right.population, null);
  assert.equal(unchanged.byDguid.right.populationDelta, null);
  assert.equal(unchanged.byDguid.right.populationAvailable, false);

  const missing = calculateCounterProposalImpact({
    originalFeatures: [], proposedFeatures: [], firstDguid: "left", secondDguid: "right",
  });
  assert.equal(missing.availability, "unavailable");
  assert.match(missing.reason, /geometr/i);

  const invalid = calculateCounterProposalImpact({
    originalFeatures: [
      { type: "Feature", properties: { DGUID: "left" }, geometry: { type: "Point", coordinates: [0, 0] } },
      feature("right", right),
    ],
    proposedFeatures: [
      { type: "Feature", properties: { DGUID: "left" }, geometry: { type: "Point", coordinates: [0, 0] } },
      feature("right", right),
    ],
    firstDguid: "left",
    secondDguid: "right",
  });
  assert.equal(invalid.availability, "unavailable");
});

test("area calculation supports holes without counting the hole as land", () => {
  const outer = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const hole = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]];
  assert.ok(geometryAreaMeters(feature("x", outer).geometry) > geometryAreaMeters(feature("x", outer, [hole]).geometry));
});

test("Commissioner hydration prefers persisted impact and falls back for legacy revisions", () => {
  const original = { type: "FeatureCollection", features: [feature("left", left), feature("right", right)] };
  const proposed = { type: "FeatureCollection", features: [feature("left", leftSmaller), feature("right", rightLarger)] };
  const persisted = {
    version: 1,
    method: "area-proportional-v1",
    availability: "available",
    byDguid: {
      left: { originalArea: 10, currentArea: 9, areaDelta: -1, population: 1000, populationDelta: -100, populationAvailable: true },
      right: { originalArea: 10, currentArea: 11, areaDelta: 1, population: 2000, populationDelta: 100, populationAvailable: true },
    },
    transfer: { fromDguid: "left", toDguid: "right", amount: 100 },
  };
  const submission = { id: "submission", type: "counter_proposal", dguid: "left", neighboring_dguid: "right" };
  const revision = {
    primary_dguid: "left", secondary_dguid: "right",
    original_geometry: original, proposed_geometry: proposed,
    validation_report: { impact_summary: persisted },
  };
  const profiles = new Map([["left", { population: 9999 }], ["right", { population: 9999 }]]);
  const persistedResult = hydrateFromPersistedRevision(submission, revision, profiles);
  assert.strictEqual(persistedResult.geometry.impacts, persisted);
  assert.equal(persistedResult.geometry.impactsSource, "persisted");

  const legacyResult = hydrateFromPersistedRevision(
    submission,
    { ...revision, validation_report: {} },
    new Map([["left", { population: 1000 }], ["right", { population: null }]]),
  );
  assert.equal(legacyResult.geometry.impactsSource, "legacy-fallback");
  assert.ok(legacyResult.geometry.impacts.transfer.amount > 0);
  assert.equal(legacyResult.geometry.impacts.byDguid.right.populationDelta, null);
});
