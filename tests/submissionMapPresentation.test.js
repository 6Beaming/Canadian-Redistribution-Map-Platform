import { test } from "@jest/globals";
import assert from "node:assert/strict";
import {
  hydrateCommentObjectionFromRelease,
  loadSubmissionMapPresentation,
} from "../src/services/submissionMapPresentation.js";

const PAIR_PAYLOAD = {
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

const DA_PAYLOAD = {
  releaseId: "statscan-da-2021-r1",
  feature: {
    type: "Feature",
    id: "2021A000100011",
    properties: { DGUID: "2021A000100011" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  },
};

test("loadSubmissionMapPresentation materializes objection pair from release envelope", async () => {
  const originalGetPair = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/da-pairs/")) {
      return {
        ok: true,
        status: 200,
        json: async () => PAIR_PAYLOAD,
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const presentation = await loadSubmissionMapPresentation({
      submission: { type: "objection", dguid: "2021A000100011", neighboring_dguid: "2021A000100012" },
      releaseId: "statscan-da-2021-r1",
      primaryDguid: "2021A000100011",
      secondaryDguid: "2021A000100012",
    });
    assert.equal(presentation?.source, "immutable-release");
    assert.equal(presentation?.objectionPreview?.featureCollection?.features?.length, 2);
  } finally {
    globalThis.fetch = originalGetPair;
  }
});

test("loadSubmissionMapPresentation materializes comment DA from release envelope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/das/")) {
      return {
        ok: true,
        status: 200,
        json: async () => DA_PAYLOAD,
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const presentation = await loadSubmissionMapPresentation({
      submission: { type: "feedback", dguid: "2021A000100011" },
      releaseId: "statscan-da-2021-r1",
      primaryDguid: "2021A000100011",
    });
    assert.equal(presentation?.source, "immutable-release");
    assert.equal(presentation?.objectionPreview?.featureCollection?.features?.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hydrateCommentObjectionFromRelease resolves active release and maps geometry", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/releases/current")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ releaseId: "statscan-da-2021-r1" }),
      };
    }
    if (String(url).includes("/das/")) {
      return {
        ok: true,
        status: 200,
        json: async () => DA_PAYLOAD,
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const hydrated = await hydrateCommentObjectionFromRelease({
      id: "sub-1",
      type: "feedback",
      dguid: "2021A000100011",
      source: "supabase",
    });
    assert.equal(hydrated.geometry?.featureCollection?.features?.length, 1);
    assert.equal(hydrated.geometryError, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
