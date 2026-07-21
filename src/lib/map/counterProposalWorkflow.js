import {
  buildDaObjectionIndex,
  getSharedBoundaryFeatureCollection,
} from "./objectionWorkflow.js";
import { getDaPopulationDisplay } from "./profileUtils.js";
import "jsts/org/locationtech/jts/monkey.js";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import IsValidOp from "jsts/org/locationtech/jts/operation/valid/IsValidOp.js";

const STORAGE_KEY = "counter-proposal-cache";
const MAX_HISTORY_ENTRIES = 10;
const EARTH_RADIUS_METERS = 6378137;
const GEOJSON_READER = new GeoJSONReader();
const TOPOLOGY_AREA_EPSILON = 1e-14;
const MINIMUM_NODE_CLEARANCE_METERS = 2;

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

function exactCoordinateKey(coordinate) {
  return `${Number(coordinate[0]).toFixed(12)},${Number(coordinate[1]).toFixed(12)}`;
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

function setCoordinateReference(
  geometry,
  polygonIndex,
  ringIndex,
  coordinateIndex,
  nextCoordinate,
) {
  const ring = getRingReference(
    geometry,
    polygonIndex,
    ringIndex,
  );

  if (!ring?.[coordinateIndex]) {
    return;
  }

  ring[coordinateIndex][0] = nextCoordinate[0];
  ring[coordinateIndex][1] = nextCoordinate[1];

  const lastIndex = ring.length - 1;

  if (lastIndex < 1) {
    return;
  }

  if (coordinateIndex === 0) {
    ring[lastIndex][0] = nextCoordinate[0];
    ring[lastIndex][1] = nextCoordinate[1];
    return;
  }

  if (coordinateIndex === lastIndex) {
    ring[0][0] = nextCoordinate[0];
    ring[0][1] = nextCoordinate[1];
  }
}

function getSharedBoundaryEndpointKeys(boundaryGeoJson) {
  const degreeByVertexKey = new Map();

  const incrementDegree = (key) => {
    degreeByVertexKey.set(key, (degreeByVertexKey.get(key) ?? 0) + 1);
  };

  boundaryGeoJson.features.forEach((feature) => {
    if (feature.geometry?.type !== "LineString") {
      return;
    }

    const coordinates = feature.geometry.coordinates;

    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const startKey = coordinateKey(coordinates[index]);
      const endKey = coordinateKey(coordinates[index + 1]);

      if (startKey === endKey) {
        continue;
      }

      incrementDegree(startKey);
      incrementDegree(endKey);
    }
  });

  return new Set(
    Array.from(degreeByVertexKey.entries())
      .filter(([, degree]) => degree === 1)
      .map(([key]) => key),
  );
}

function buildSharedBoundaryHandles(features, boundaryGeoJson) {
  const sharedVertexKeys = new Set();
  const endpointKeys = getSharedBoundaryEndpointKeys(boundaryGeoJson);

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

      if (!sharedVertexKeys.has(key) || endpointKeys.has(key)) {
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

function getRingReference(geometry, polygonIndex, ringIndex) {
  if (!geometry) {
    return null;
  }

  if (geometry.type === "Polygon") {
    return geometry.coordinates?.[ringIndex] ?? null;
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates?.[polygonIndex]?.[ringIndex] ?? null;
  }

  return null;
}

function coordinatesEqual(left, right, epsilon = 1e-9) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  return (
    Math.abs(Number(left[0]) - Number(right[0])) <= epsilon &&
    Math.abs(Number(left[1]) - Number(right[1])) <= epsilon
  );
}

function interpolateCoordinate(start, end, weight) {
  return [
    start[0] + (end[0] - start[0]) * weight,
    start[1] + (end[1] - start[1]) * weight,
  ];
}

function buildMovedCurrentFeatures(currentFeatures, handle, nextCoordinate) {
  const nextCurrentFeatures = cloneValue(currentFeatures);
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

  return nextCurrentFeatures;
}

function isFiniteCoordinate(coordinate) {
  return (
    Array.isArray(coordinate) &&
    Number.isFinite(Number(coordinate[0])) &&
    Number.isFinite(Number(coordinate[1]))
  );
}

function projectGeoJsonCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) {
    return coordinates;
  }

  if (
    coordinates.length >= 2 &&
    Number.isFinite(Number(coordinates[0])) &&
    Number.isFinite(Number(coordinates[1]))
  ) {
    return projectLngLatToMeters(coordinates);
  }

  return coordinates.map(projectGeoJsonCoordinates);
}

function projectGeoJsonGeometry(geometry) {
  if (!geometry?.type || !geometry.coordinates) {
    return null;
  }

  return {
    type: geometry.type,
    coordinates: projectGeoJsonCoordinates(geometry.coordinates),
  };
}

function readProjectedGeometry(geometry) {
  const projectedGeometry = projectGeoJsonGeometry(geometry);
  return projectedGeometry ? GEOJSON_READER.read(projectedGeometry) : null;
}

function readProjectedPoint(coordinate) {
  return GEOJSON_READER.read({
    type: "Point",
    coordinates: projectLngLatToMeters(coordinate),
  });
}

function isValidRing(ring) {
  if (
    !Array.isArray(ring) ||
    ring.length < 4 ||
    !coordinatesEqual(ring[0], ring[ring.length - 1]) ||
    !ring.every(isFiniteCoordinate)
  ) {
    return false;
  }

  for (let index = 0; index < ring.length - 1; index += 1) {
    if (coordinatesEqual(ring[index], ring[index + 1])) {
      return false;
    }
  }

  return ringAreaMeters(ring) > 0;
}

function isFeatureGeometryStructurallyValid(geometry) {
  if (geometry?.type === "Polygon") {
    return geometry.coordinates.every(isValidRing);
  }

  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates.every(
      (polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(isValidRing),
    );
  }

  return false;
}

function getGeometryValidationIssue(geometry) {
  try {
    const projectedGeometry = readProjectedGeometry(geometry);

    if (!projectedGeometry) {
      return { reason: "Geometry could not be read." };
    }

    const validity = new IsValidOp(projectedGeometry);

    if (validity.isValid()) {
      return null;
    }

    return {
      reason: validity.getValidationError()?.getMessage() ?? "Invalid geometry.",
    };
  } catch {
    return { reason: "Geometry could not be validated." };
  }
}

function visitGeometryRings(geometry, callback) {
  if (geometry?.type === "Polygon") {
    geometry.coordinates.forEach((ring, ringIndex) => callback(ring, 0, ringIndex));
    return;
  }

  if (geometry?.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon, polygonIndex) => {
      polygon.forEach((ring, ringIndex) => callback(ring, polygonIndex, ringIndex));
    });
  }
}

function buildDuplicateVertexRemovalCandidates(feature) {
  const candidates = [];

  visitGeometryRings(feature.geometry, (ring, polygonIndex, ringIndex) => {
    if (!Array.isArray(ring) || ring.length < 5) {
      return;
    }

    const firstIndexByCoordinate = new Map();

    for (let coordinateIndex = 0; coordinateIndex < ring.length - 1; coordinateIndex += 1) {
      const coordinate = ring[coordinateIndex];
      const key = exactCoordinateKey(coordinate);
      const firstIndex = firstIndexByCoordinate.get(key);

      if (firstIndex === undefined) {
        firstIndexByCoordinate.set(key, coordinateIndex);
        continue;
      }

      const candidate = cloneValue(feature);
      const candidateRing = getRingReference(
        candidate.geometry,
        polygonIndex,
        ringIndex,
      );

      candidateRing?.splice(coordinateIndex, 1);
      candidates.push({
        feature: candidate,
        removedCoordinate: [...coordinate],
        polygonIndex,
        ringIndex,
        coordinateIndex,
        duplicateOfIndex: firstIndex,
      });
    }
  });

  return candidates;
}

function repairDuplicateRingVertex(feature) {
  const sourceFeature = cloneValue(feature);
  const sourceIssue = getGeometryValidationIssue(sourceFeature.geometry);

  if (!sourceIssue) {
    return { feature: sourceFeature, repair: null, issue: null };
  }

  const sourceArea = geometryAreaMeters(sourceFeature.geometry);
  const repair = buildDuplicateVertexRemovalCandidates(sourceFeature)
    .filter(({ feature: candidate }) => isFeatureGeometryStructurallyValid(candidate.geometry))
    .filter(({ feature: candidate }) => !getGeometryValidationIssue(candidate.geometry))
    .sort((left, right) => {
      const leftAreaDelta = Math.abs(geometryAreaMeters(left.feature.geometry) - sourceArea);
      const rightAreaDelta = Math.abs(geometryAreaMeters(right.feature.geometry) - sourceArea);
      return leftAreaDelta - rightAreaDelta;
    })[0];

  if (!repair) {
    return { feature: sourceFeature, repair: null, issue: sourceIssue };
  }

  const repairedArea = geometryAreaMeters(repair.feature.geometry);

  return {
    feature: repair.feature,
    repair: {
      type: "remove-duplicate-ring-vertex",
      dguid: getFeatureDguid(sourceFeature),
      removedCoordinate: repair.removedCoordinate,
      polygonIndex: repair.polygonIndex,
      ringIndex: repair.ringIndex,
      coordinateIndex: repair.coordinateIndex,
      duplicateOfIndex: repair.duplicateOfIndex,
      areaDeltaMeters: repairedArea - sourceArea,
    },
    issue: null,
  };
}

function normalizeCounterProposalSourceFeatures(features) {
  const repairs = [];
  const issues = [];
  const normalizedFeatures = features.map((feature) => {
    const result = repairDuplicateRingVertex(feature);

    if (result.repair) {
      repairs.push(result.repair);
    }

    if (result.issue) {
      issues.push({
        dguid: getFeatureDguid(feature),
        ...result.issue,
      });
    }

    return result.feature;
  });

  return { features: normalizedFeatures, repairs, issues };
}

/**
 * JSTS is the authoritative topology check for an edited DA pair.  Both DA
 * geometries must stay valid, remain covered by their original combined area,
 * have no interior overlap, and still cover exactly that original area.  The
 * final equality check catches both illegal cuts (gaps) and folded overlaps.
 */
export function validateCounterProposalTopology(originalFeatures, currentFeatures) {
  const topologyValid = hasValidCounterProposalTopology(originalFeatures, currentFeatures);

  return {
    valid: topologyValid,
    checks: {
      featureCount: Array.isArray(currentFeatures) && currentFeatures.length === 2,
      topology: topologyValid,
    },
  };
}

function hasValidCounterProposalTopology(originalFeatures, currentFeatures) {
  try {
    if (!Array.isArray(originalFeatures) || !Array.isArray(currentFeatures) || currentFeatures.length !== 2) {
      return false;
    }

    const originalGeometries = originalFeatures.map((feature) =>
      readProjectedGeometry(feature.geometry),
    );
    const currentGeometries = currentFeatures.map((feature) =>
      readProjectedGeometry(feature.geometry),
    );

    if (originalGeometries.some((geometry) => !geometry?.isValid())) {
      return false;
    }

    if (currentGeometries.some((geometry) => !geometry?.isValid())) {
      return false;
    }

    const allowedArea = originalGeometries[0].union(originalGeometries[1]);
    const currentArea = currentGeometries[0].union(currentGeometries[1]);

    if (currentGeometries.some((geometry) => !allowedArea.covers(geometry))) {
      return false;
    }

    const interiorOverlap = currentGeometries[0]
      .intersection(currentGeometries[1])
      .getArea();

    return interiorOverlap <= TOPOLOGY_AREA_EPSILON && allowedArea.equalsTopo(currentArea);
  } catch {
    // JSTS throws a topology error for invalid candidate geometries. Treat it
    // exactly like a rejected drag rather than leaving the map in an invalid state.
    return false;
  }
}

function visitRingSegments(ring, callback) {
  if (!Array.isArray(ring) || ring.length < 2) {
    return;
  }

  for (let index = 0; index < ring.length - 1; index += 1) {
    callback(ring[index], ring[index + 1]);
  }
}

function visitGeometrySegments(geometry, callback) {
  if (geometry?.type === "Polygon") {
    geometry.coordinates.forEach((ring) => visitRingSegments(ring, callback));
    return;
  }

  if (geometry?.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      polygon.forEach((ring) => visitRingSegments(ring, callback));
    });
  }
}

function hasSufficientNodeClearance(currentFeatures, nextCoordinate) {
  const nonIncidentSegments = [];

  currentFeatures.forEach((feature) => {
    visitGeometrySegments(feature.geometry, (start, end) => {
      if (coordinatesEqual(start, nextCoordinate) || coordinatesEqual(end, nextCoordinate)) {
        return;
      }

      nonIncidentSegments.push([
        projectLngLatToMeters(start),
        projectLngLatToMeters(end),
      ]);
    });
  });

  if (!nonIncidentSegments.length) {
    return true;
  }

  const candidatePoint = readProjectedPoint(nextCoordinate);
  const nonIncidentBoundary = GEOJSON_READER.read({
    type: "MultiLineString",
    coordinates: nonIncidentSegments,
  });

  return candidatePoint.distance(nonIncidentBoundary) >= MINIMUM_NODE_CLEARANCE_METERS;
}

function isStrictlyInsideOriginalPair(originalFeatures, nextCoordinate) {
  try {
    const originalGeometries = originalFeatures.map((feature) =>
      readProjectedGeometry(feature.geometry),
    );

    if (originalGeometries.some((geometry) => !geometry?.isValid())) {
      return false;
    }

    const allowedArea = originalGeometries[0].union(originalGeometries[1]);
    const candidatePoint = readProjectedPoint(nextCoordinate);

    return (
      allowedArea.contains(candidatePoint) &&
      candidatePoint.distance(allowedArea.getBoundary()) >= MINIMUM_NODE_CLEARANCE_METERS
    );
  } catch {
    return false;
  }
}

function isHandleMoveWithinAllowedRegion(cache, handle, nextCoordinate) {
  if (!cache || !handle || !Array.isArray(nextCoordinate)) {
    return false;
  }

  if (!isStrictlyInsideOriginalPair(cache.originalFeatures, nextCoordinate)) {
    return false;
  }

  const nextCurrentFeatures = buildMovedCurrentFeatures(
    cache.currentFeatures,
    handle,
    nextCoordinate,
  );

  if (nextCurrentFeatures.some((feature) => !isFeatureGeometryStructurallyValid(feature.geometry))) {
    return false;
  }

  if (!hasSufficientNodeClearance(nextCurrentFeatures, nextCoordinate)) {
    return false;
  }

  return hasValidCounterProposalTopology(cache.originalFeatures, nextCurrentFeatures);
}

function constrainHandleMoveCoordinate(cache, handle, nextCoordinate) {
  if (isHandleMoveWithinAllowedRegion(cache, handle, nextCoordinate)) {
    return [...nextCoordinate];
  }

  let lowerBound = [...handle.coordinate];
  let upperBound = [...nextCoordinate];
  let best = [...handle.coordinate];

  for (let index = 0; index < 16; index += 1) {
    const candidate = interpolateCoordinate(lowerBound, upperBound, 0.5);

    if (isHandleMoveWithinAllowedRegion(cache, handle, candidate)) {
      best = candidate;
      lowerBound = candidate;
    } else {
      upperBound = candidate;
    }
  }

  return best;
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
      sourceGeometryRepairs: workflow.cache.sourceGeometryRepairs,
      sourceGeometryIssues: workflow.cache.sourceGeometryIssues,
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

  const normalization = normalizeCounterProposalSourceFeatures([
    firstFeature,
    secondFeature,
  ]);
  const originalFeatures = normalization.features;
  const currentFeatures = cloneValue(originalFeatures);
  const sourceGeometryIssues = [...normalization.issues];

  if (!sourceGeometryIssues.length && !hasValidCounterProposalTopology(originalFeatures, currentFeatures)) {
    sourceGeometryIssues.push({
      dguid: `${String(firstDguid)}|${String(secondDguid)}`,
      reason: "The repaired DA pair does not form a valid shared-boundary topology.",
    });
  }

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
    sourceGeometryRepairs: normalization.repairs,
    sourceGeometryIssues,
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

  const constrainedCoordinate = constrainHandleMoveCoordinate(cache, handle, nextCoordinate);

  const currentKey = coordinateKey(handle.coordinate);
  const nextKey = coordinateKey(constrainedCoordinate);

  if (currentKey === nextKey) {
    return cache;
  }

  const nextCurrentFeatures = buildMovedCurrentFeatures(
    cache.currentFeatures,
    handle,
    constrainedCoordinate,
  );

  const nextHandles = cache.handles.map((entry) =>
    entry.id === handleId
      ? {
          ...entry,
          coordinate: [...constrainedCoordinate],
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
      constrainedCoordinate,
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
