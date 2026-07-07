import {
  buildDaObjectionIndex,
  getSharedBoundaryFeatureCollection,
} from "./objectionWorkflow.js";
import { getDaPopulationDisplay } from "./profileUtils.js";

const STORAGE_KEY = "counter-proposal-cache";
const MAX_HISTORY_ENTRIES = 10;
const EARTH_RADIUS_METERS = 6378137;

function cloneValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeNumber(value) {
  return Number(value).toFixed(6);
}

function coordinateKey(coordinate) {
  return `${normalizeNumber(coordinate[0])},${normalizeNumber(coordinate[1])}`;
}

function createFeatureCollection(features = []) {
  return {
    type: "FeatureCollection",
    features,
  };
}

function getFeatureDguid(feature) {
  return String(feature?.properties?.DGUID ?? feature?.id ?? "");
}

function getPopulationLookup(profilesByDguid, firstDguid, secondDguid) {
  return {
    [firstDguid]: Number(getDaPopulationDisplay(profilesByDguid.get(firstDguid))) || 0,
    [secondDguid]: Number(getDaPopulationDisplay(profilesByDguid.get(secondDguid))) || 0,
  };
}

function visitGeometryCoordinates(geometry, callback) {
  if (!geometry) {
    return;
  }

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring, ringIndex) => {
      ring.forEach((coordinate, coordinateIndex) => {
        callback({
          coordinate,
          polygonIndex: 0,
          ringIndex,
          coordinateIndex,
        });
      });
    });
    return;
  }

  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon, polygonIndex) => {
      polygon.forEach((ring, ringIndex) => {
        ring.forEach((coordinate, coordinateIndex) => {
          callback({
            coordinate,
            polygonIndex,
            ringIndex,
            coordinateIndex,
          });
        });
      });
    });
  }
}

function getCoordinateReference(geometry, polygonIndex, ringIndex, coordinateIndex) {
  if (!geometry) {
    return null;
  }

  if (geometry.type === "Polygon") {
    return geometry.coordinates?.[ringIndex]?.[coordinateIndex] ?? null;
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates?.[polygonIndex]?.[ringIndex]?.[coordinateIndex] ?? null;
  }

  return null;
}

function setCoordinateReference(
  geometry,
  polygonIndex,
  ringIndex,
  coordinateIndex,
  nextCoordinate,
) {
  const target = getCoordinateReference(
    geometry,
    polygonIndex,
    ringIndex,
    coordinateIndex,
  );

  if (!target) {
    return;
  }

  target[0] = nextCoordinate[0];
  target[1] = nextCoordinate[1];
}

function buildSharedBoundaryHandles(features, boundaryGeoJson) {
  const sharedVertexKeys = new Set();

  boundaryGeoJson.features.forEach((feature) => {
    if (feature.geometry?.type !== "LineString") {
      return;
    }

    feature.geometry.coordinates.forEach((coordinate) => {
      sharedVertexKeys.add(coordinateKey(coordinate));
    });
  });

  const handlesById = new Map();

  features.forEach((feature) => {
    const dguid = getFeatureDguid(feature);

    visitGeometryCoordinates(feature.geometry, (entry) => {
      const key = coordinateKey(entry.coordinate);

      if (!sharedVertexKeys.has(key)) {
        return;
      }

      if (!handlesById.has(key)) {
        handlesById.set(key, {
          id: key,
          coordinate: [...entry.coordinate],
          featureDguids: new Set(),
          occurrences: [],
        });
      }

      const handle = handlesById.get(key);
      handle.featureDguids.add(dguid);
      handle.occurrences.push({
        featureDguid: dguid,
        polygonIndex: entry.polygonIndex,
        ringIndex: entry.ringIndex,
        coordinateIndex: entry.coordinateIndex,
      });
    });
  });

  return Array.from(handlesById.values())
    .map((handle) => ({
      id: handle.id,
      coordinate: handle.coordinate,
      featureDguids: Array.from(handle.featureDguids),
      occurrences: handle.occurrences,
    }))
    .sort((left, right) => {
      if (left.coordinate[1] !== right.coordinate[1]) {
        return right.coordinate[1] - left.coordinate[1];
      }

      return left.coordinate[0] - right.coordinate[0];
    });
}

function buildHandleFeatureCollection(handles, selectedHandleId) {
  return {
    type: "FeatureCollection",
    features: handles.map((handle, index) => ({
      type: "Feature",
      properties: {
        id: handle.id,
        index: index + 1,
        selected: handle.id === selectedHandleId,
      },
      geometry: {
        type: "Point",
        coordinates: handle.coordinate,
      },
    })),
  };
}

function updateBoundaryFeatureCollection(boundaryGeoJson, fromCoordinate, toCoordinate) {
  const fromKey = coordinateKey(fromCoordinate);

  return {
    type: "FeatureCollection",
    features: boundaryGeoJson.features.map((feature) => ({
      ...feature,
      geometry:
        feature.geometry?.type === "LineString"
          ? {
              ...feature.geometry,
              coordinates: feature.geometry.coordinates.map((coordinate) =>
                coordinateKey(coordinate) === fromKey ? [...toCoordinate] : [...coordinate],
              ),
            }
          : feature.geometry,
    })),
  };
}

function projectLngLatToMeters(coordinate) {
  const lng = coordinate[0] * (Math.PI / 180);
  const lat = Math.max(Math.min(coordinate[1], 89.9), -89.9) * (Math.PI / 180);

  return [
    EARTH_RADIUS_METERS * lng,
    EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + lat / 2)),
  ];
}

function ringAreaMeters(ring) {
  if (!Array.isArray(ring) || ring.length < 3) {
    return 0;
  }

  let sum = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x0, y0] = projectLngLatToMeters(ring[index]);
    const [x1, y1] = projectLngLatToMeters(ring[index + 1]);
    sum += x0 * y1 - x1 * y0;
  }

  return Math.abs(sum) / 2;
}

function geometryAreaMeters(geometry) {
  if (!geometry) {
    return 0;
  }

  if (geometry.type === "Polygon") {
    return Math.max(
      0,
      ringAreaMeters(geometry.coordinates[0]) -
        geometry.coordinates
          .slice(1)
          .reduce((sum, ring) => sum + ringAreaMeters(ring), 0),
    );
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((sum, polygon) => {
      if (!polygon.length) {
        return sum;
      }

      const outerArea = ringAreaMeters(polygon[0]);
      const holeArea = polygon
        .slice(1)
        .reduce((innerSum, ring) => innerSum + ringAreaMeters(ring), 0);

      return sum + Math.max(0, outerArea - holeArea);
    }, 0);
  }

  return 0;
}

function isPointOnSegment(point, start, end, epsilon = 1e-9) {
  const cross =
    (point[1] - start[1]) * (end[0] - start[0]) -
    (point[0] - start[0]) * (end[1] - start[1]);

  if (Math.abs(cross) > epsilon) {
    return false;
  }

  const dot =
    (point[0] - start[0]) * (end[0] - start[0]) +
    (point[1] - start[1]) * (end[1] - start[1]);

  if (dot < -epsilon) {
    return false;
  }

  const squaredLength =
    (end[0] - start[0]) * (end[0] - start[0]) +
    (end[1] - start[1]) * (end[1] - start[1]);

  return dot <= squaredLength + epsilon;
}

function isPointInRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 3) {
    return false;
  }

  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];

    if (isPointOnSegment(point, previousPoint, currentPoint)) {
      return true;
    }

    const intersects =
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointInGeometry(point, geometry) {
  if (!geometry) {
    return false;
  }

  if (geometry.type === "Polygon") {
    if (!isPointInRing(point, geometry.coordinates[0])) {
      return false;
    }

    return !geometry.coordinates.slice(1).some((ring) => isPointInRing(point, ring));
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => {
      if (!polygon.length) {
        return false;
      }

      if (!isPointInRing(point, polygon[0])) {
        return false;
      }

      return !polygon.slice(1).some((ring) => isPointInRing(point, ring));
    });
  }

  return false;
}

function isPointWithinFeatureSet(features, point) {
  return features.some((feature) => isPointInGeometry(point, feature.geometry));
}

function buildImpactSummary(
  originalFeatures,
  currentFeatures,
  populationByDguid,
  firstDguid,
  secondDguid,
) {
  const originalAreaByDguid = {};
  const currentAreaByDguid = {};

  originalFeatures.forEach((feature) => {
    const dguid = getFeatureDguid(feature);
    originalAreaByDguid[dguid] = geometryAreaMeters(feature.geometry);
  });

  currentFeatures.forEach((feature) => {
    const dguid = getFeatureDguid(feature);
    currentAreaByDguid[dguid] = geometryAreaMeters(feature.geometry);
  });

  const firstOriginalArea = originalAreaByDguid[firstDguid] ?? 0;
  const secondOriginalArea = originalAreaByDguid[secondDguid] ?? 0;
  const firstCurrentArea = currentAreaByDguid[firstDguid] ?? 0;
  const secondCurrentArea = currentAreaByDguid[secondDguid] ?? 0;
  const firstAreaDelta = firstCurrentArea - firstOriginalArea;
  const secondAreaDelta = secondCurrentArea - secondOriginalArea;
  const firstPopulation = populationByDguid[firstDguid] ?? 0;
  const secondPopulation = populationByDguid[secondDguid] ?? 0;

  let transfer = {
    fromDguid: null,
    toDguid: null,
    amount: 0,
  };

  if (firstAreaDelta < 0 && firstOriginalArea > 0) {
    transfer = {
      fromDguid: firstDguid,
      toDguid: secondDguid,
      amount: (Math.abs(firstAreaDelta) / firstOriginalArea) * firstPopulation,
    };
  } else if (secondAreaDelta < 0 && secondOriginalArea > 0) {
    transfer = {
      fromDguid: secondDguid,
      toDguid: firstDguid,
      amount: (Math.abs(secondAreaDelta) / secondOriginalArea) * secondPopulation,
    };
  }

  const byDguid = {
    [firstDguid]: {
      originalArea: firstOriginalArea,
      currentArea: firstCurrentArea,
      areaDelta: firstAreaDelta,
      population: firstPopulation,
      populationDelta:
        transfer.fromDguid === firstDguid
          ? -transfer.amount
          : transfer.toDguid === firstDguid
            ? transfer.amount
            : 0,
    },
    [secondDguid]: {
      originalArea: secondOriginalArea,
      currentArea: secondCurrentArea,
      areaDelta: secondAreaDelta,
      population: secondPopulation,
      populationDelta:
        transfer.fromDguid === secondDguid
          ? -transfer.amount
          : transfer.toDguid === secondDguid
            ? transfer.amount
            : 0,
    },
  };

  return {
    byDguid,
    transfer,
  };
}

function rebuildCounterProposalCache(baseCache, nextCurrentFeatures, nextSelectedHandleId = null) {
  const currentFeatures = cloneValue(nextCurrentFeatures);
  const pairIndex = buildDaObjectionIndex(createFeatureCollection(currentFeatures));
  const sharedBoundaryGeoJson = getSharedBoundaryFeatureCollection(
    pairIndex,
    baseCache.firstDguid,
    baseCache.secondDguid,
  );
  const handles = buildSharedBoundaryHandles(currentFeatures, sharedBoundaryGeoJson);
  const selectedHandleId = handles.some((handle) => handle.id === nextSelectedHandleId)
    ? nextSelectedHandleId
    : null;

  return {
    ...baseCache,
    currentFeatures,
    currentFeatureCollection: createFeatureCollection(currentFeatures),
    pairIndex,
    sharedBoundaryGeoJson,
    handles,
    handleFeatureCollection: buildHandleFeatureCollection(handles, selectedHandleId),
    selectedHandleId,
    impacts: buildImpactSummary(
      baseCache.originalFeatures,
      currentFeatures,
      baseCache.populationByDguid,
      baseCache.firstDguid,
      baseCache.secondDguid,
    ),
  };
}

function snapshotFeatures(features) {
  return cloneValue(features);
}

function canRestoreSnapshot(snapshot) {
  return Array.isArray(snapshot) && snapshot.length >= 2;
}

export function emptyCounterProposalFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export function createInitialCounterProposalWorkflow(overrides = {}) {
  return {
    step: 1,
    firstDguid: null,
    secondDguid: null,
    error: "",
    cache: null,
    previewMode: "proposal",
    dragBaselineSnapshot: null,
    ...overrides,
  };
}

export function clearCounterProposalStorage() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}

export function writeCounterProposalStorage(workflow) {
  if (typeof window === "undefined") {
    return;
  }

  if (!workflow?.cache) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  const payload = {
    version: 1,
    step: workflow.step,
    firstDguid: workflow.firstDguid,
    secondDguid: workflow.secondDguid,
    previewMode: workflow.previewMode,
    cache: {
      id: workflow.cache.id,
      sourceAsset: workflow.cache.sourceAsset,
      createdAt: workflow.cache.createdAt,
      firstDguid: workflow.cache.firstDguid,
      secondDguid: workflow.cache.secondDguid,
      populationByDguid: workflow.cache.populationByDguid,
      currentFeatures: workflow.cache.currentFeatures,
      history: workflow.cache.history,
      future: workflow.cache.future,
      selectedHandleId: workflow.cache.selectedHandleId,
    },
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function buildCounterProposalCache(
  index,
  profilesByDguid,
  firstDguid,
  secondDguid,
) {
  const firstFeature = index?.featureByDguid.get(String(firstDguid));
  const secondFeature = index?.featureByDguid.get(String(secondDguid));

  if (!firstFeature || !secondFeature) {
    return null;
  }

  const originalFeatures = [cloneValue(firstFeature), cloneValue(secondFeature)];
  const currentFeatures = cloneValue(originalFeatures);
  const populationByDguid = getPopulationLookup(
    profilesByDguid,
    String(firstDguid),
    String(secondDguid),
  );

  const baseCache = {
    id: `${String(firstDguid)}:${String(secondDguid)}`,
    createdAt: new Date().toISOString(),
    sourceAsset: "counter-proposal-cache",
    firstDguid: String(firstDguid),
    secondDguid: String(secondDguid),
    originalFeatures,
    populationByDguid,
    history: [],
    future: [],
  };

  const rebuilt = rebuildCounterProposalCache(baseCache, currentFeatures, null);

  return {
    ...rebuilt,
    history: [snapshotFeatures(rebuilt.currentFeatures)],
    future: [],
  };
}

export function selectCounterProposalHandle(cache, handleId) {
  if (!cache) {
    return cache;
  }

  if (cache.selectedHandleId === handleId) {
    return cache;
  }

  return {
    ...cache,
    selectedHandleId: handleId,
    handleFeatureCollection: buildHandleFeatureCollection(cache.handles, handleId),
  };
}

export function previewCounterProposalHandleMove(cache, handleId, nextCoordinate) {
  if (!cache || !handleId || !Array.isArray(nextCoordinate)) {
    return cache;
  }

  const handle = cache.handles.find((entry) => entry.id === handleId);

  if (!handle) {
    return cache;
  }

  if (!isPointWithinFeatureSet(cache.originalFeatures, nextCoordinate)) {
    return cache;
  }

  const currentKey = coordinateKey(handle.coordinate);
  const nextKey = coordinateKey(nextCoordinate);

  if (currentKey === nextKey) {
    return cache;
  }

  const nextCurrentFeatures = cloneValue(cache.currentFeatures);
  const featureLookup = new Map(
    nextCurrentFeatures.map((feature) => [getFeatureDguid(feature), feature]),
  );

  handle.occurrences.forEach((occurrence) => {
    const feature = featureLookup.get(occurrence.featureDguid);

    if (!feature) {
      return;
    }

    setCoordinateReference(
      feature.geometry,
      occurrence.polygonIndex,
      occurrence.ringIndex,
      occurrence.coordinateIndex,
      nextCoordinate,
    );
  });

  const nextHandles = cache.handles.map((entry) =>
    entry.id === handleId
      ? {
          ...entry,
          coordinate: [...nextCoordinate],
        }
      : entry,
  );

  return {
    ...cache,
    currentFeatures: nextCurrentFeatures,
    currentFeatureCollection: createFeatureCollection(nextCurrentFeatures),
    sharedBoundaryGeoJson: updateBoundaryFeatureCollection(
      cache.sharedBoundaryGeoJson,
      handle.coordinate,
      nextCoordinate,
    ),
    handles: nextHandles,
    handleFeatureCollection: buildHandleFeatureCollection(nextHandles, handleId),
    selectedHandleId: handleId,
    impacts: buildImpactSummary(
      cache.originalFeatures,
      nextCurrentFeatures,
      cache.populationByDguid,
      cache.firstDguid,
      cache.secondDguid,
    ),
  };
}

export function commitCounterProposalCacheHistory(cache, baselineSnapshot = null) {
  if (!cache) {
    return cache;
  }

  const currentSnapshot = snapshotFeatures(cache.currentFeatures);
  const lastSnapshot = baselineSnapshot ?? cache.history[cache.history.length - 1] ?? null;

  if (lastSnapshot && JSON.stringify(lastSnapshot) === JSON.stringify(currentSnapshot)) {
    return cache;
  }

  const nextHistory = [...cache.history, currentSnapshot].slice(-MAX_HISTORY_ENTRIES);

  return {
    ...cache,
    history: nextHistory,
    future: [],
  };
}

export function undoCounterProposalCache(cache) {
  if (!cache || cache.history.length <= 1) {
    return cache;
  }

  const previousSnapshot = cache.history[cache.history.length - 2];
  const currentSnapshot = cache.history[cache.history.length - 1];

  if (!canRestoreSnapshot(previousSnapshot)) {
    return cache;
  }

  const rebuilt = rebuildCounterProposalCache(
    cache,
    previousSnapshot,
    cache.selectedHandleId,
  );

  return {
    ...rebuilt,
    history: cache.history.slice(0, -1),
    future: [currentSnapshot, ...cache.future].slice(0, MAX_HISTORY_ENTRIES),
  };
}

export function redoCounterProposalCache(cache) {
  if (!cache || !cache.future.length) {
    return cache;
  }

  const nextSnapshot = cache.future[0];

  if (!canRestoreSnapshot(nextSnapshot)) {
    return cache;
  }

  const rebuilt = rebuildCounterProposalCache(
    cache,
    nextSnapshot,
    cache.selectedHandleId,
  );

  return {
    ...rebuilt,
    history: [...cache.history, snapshotFeatures(rebuilt.currentFeatures)].slice(
      -MAX_HISTORY_ENTRIES,
    ),
    future: cache.future.slice(1),
  };
}
