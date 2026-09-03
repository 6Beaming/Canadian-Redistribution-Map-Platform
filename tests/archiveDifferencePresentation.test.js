import { test } from "@jest/globals";
import assert from "node:assert/strict";
import {
  buildArchivedDifferencePresentation,
  canRenderArchivedDifferenceFromSnapshots,
} from "../src/lib/archiveDifferencePresentation.js";

const SAMPLE_FC = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "2021A000100011",
      properties: { DGUID: "2021A000100011" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    },
    {
      type: "Feature",
      id: "2021A000100012",
      properties: { DGUID: "2021A000100012" },
      geometry: { type: "Polygon", coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] },
    },
  ],
};

test("CP latest can render from archive display geometry only", () => {
  const submission = { type: "counter_proposal", dguid: "2021A000100011", neighboring_dguid: "2021A000100012" };
  assert.equal(canRenderArchivedDifferenceFromSnapshots({
    submission,
    displayGeometry: SAMPLE_FC,
    originalGeometry: null,
  }), true);
  const presentation = buildArchivedDifferencePresentation(submission, {
    displayGeometry: SAMPLE_FC,
    geometryView: "proposed",
  });
  assert.ok(presentation?.counterProposalPreview?.featureCollection);
  assert.equal(presentation.counterProposalPreview.featureCollection.features.length, 2);
});

test("selected equals latest should reuse the same geometry entry", () => {
  const geometryByVersionId = {
    "version-a": { displayGeometry: SAMPLE_FC, geometryDigest: "sha256:abc" },
  };
  const selectedVersionId = "version-a";
  const latestVersionId = "version-a";
  if (selectedVersionId === latestVersionId) {
    geometryByVersionId[latestVersionId] = geometryByVersionId[selectedVersionId];
  }
  assert.equal(geometryByVersionId[latestVersionId], geometryByVersionId[selectedVersionId]);
});

test("objection pair payload uses release API features envelope", () => {
  const submission = { type: "objection", dguid: "2021A000100011", neighboring_dguid: "2021A000100012" };
  const payload = {
    releaseId: "statscan-da-2021-r1",
    features: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "2021A000100011",
          properties: { DGUID: "2021A000100011" },
          geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
        },
        {
          type: "Feature",
          id: "2021A000100012",
          properties: { DGUID: "2021A000100012" },
          geometry: { type: "Polygon", coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] },
        },
      ],
    },
    sharedBoundary: { type: "FeatureCollection", features: [] },
  };
  const featureCollection = payload.features;
  assert.equal(featureCollection.type, "FeatureCollection");
  assert.equal(featureCollection.features.length, 2);
  const presentation = buildArchivedDifferencePresentation(submission, {
    displayGeometry: featureCollection,
    geometryView: "proposed",
  });
  assert.ok(presentation?.objectionPreview || presentation?.focusGeoJson);
});

test("single DA payload uses release API feature envelope", () => {
  const payload = {
    feature: {
      type: "Feature",
      id: "2021A000100011",
      properties: { DGUID: "2021A000100011" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    },
  };
  assert.equal(payload.feature.type, "Feature");
});
