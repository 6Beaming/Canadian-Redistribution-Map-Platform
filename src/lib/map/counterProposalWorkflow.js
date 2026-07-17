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

function classifyPointInRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 3) {
    return "outside";
  }

  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];

    if (isPointOnSegment(point, previousPoint, currentPoint)) {
      return "boundary";
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

  return inside ? "inside" : "outside";
}

function isPointCoveredByPolygon(point, polygon) {
  if (!Array.isArray(polygon) || !polygon.length) {
    return false;
  }

  const outerRingPosition = classifyPointInRing(point, polygon[0]);

  if (outerRingPosition === "outside") {
    return false;
  }

  if (outerRingPosition === "boundary") {
    return true;
  }

  for (const hole of polygon.slice(1)) {
    const holePosition = classifyPointInRing(point, hole);

    if (holePosition === "boundary") {
      return true;
    }

    if (holePosition === "inside") {
      return false;
    }
  }

  return true;
}

function isPointInGeometry(point, geometry) {
  if (!geometry) {
    return false;
  }

  if (geometry.type === "Polygon") {
    return isPointCoveredByPolygon(point, geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => isPointCoveredByPolygon(point, polygon));
  }

  return false;
}

function isPointWithinFeatureSet(features, point) {
  return features.some((feature) => isPointInGeometry(point, feature.geometry));
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

function segmentLengthMeters(start, end) {
  const [x0, y0] = projectLngLatToMeters(start);
  const [x1, y1] = projectLngLatToMeters(end);
  return Math.hypot(x1 - x0, y1 - y0);
}

function getSegmentSampleCount(start, end) {
  return Math.min(240, Math.max(24, Math.ceil(segmentLengthMeters(start, end) / 1500)));
}

function visitGeometrySegments(featureDguid, geometry, callback) {
  if (!geometry) {
    return;
  }

  const visitRingSegments = (ring, polygonIndex, ringIndex) => {
    if (!Array.isArray(ring) || ring.length < 2) {
      return;
    }

    const segmentCount = ring.length - 1;

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      callback({
        featureDguid,
        polygonIndex,
        ringIndex,
        ringLength: ring.length,
        segmentCount,
        segmentIndex,
        startIndex: segmentIndex,
        endIndex: segmentIndex + 1,
        start: ring[segmentIndex],
        end: ring[segmentIndex + 1],
      });
    }
  };

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring, ringIndex) => {
      visitRingSegments(ring, 0, ringIndex);
    });
    return;
  }

  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon, polygonIndex) => {
      polygon.forEach((ring, ringIndex) => {
        visitRingSegments(ring, polygonIndex, ringIndex);
      });
    });
  }
}

function interpolateCoordinate(start, end, weight) {
  return [
    start[0] + (end[0] - start[0]) * weight,
    start[1] + (end[1] - start[1]) * weight,
  ];
}

function isSegmentWithinFeatureSet(features, start, end, sampleCount = 18) {
  for (let step = 0; step <= sampleCount; step += 1) {
    const weight = step / sampleCount;
    const point = interpolateCoordinate(start, end, weight);

    if (!isPointWithinFeatureSet(features, point)) {
      return false;
    }
  }

  return true;
}

function getRingMoveIndex(ring, coordinateIndex) {
  if (!Array.isArray(ring) || ring.length < 2) {
    return -1;
  }

  const lastIndex = ring.length - 1;
  return coordinateIndex === lastIndex ? 0 : coordinateIndex;
}

function buildChangedSegmentEntries(feature, occurrence) {
  const ring = getRingReference(
    feature?.geometry,
    occurrence.polygonIndex,
    occurrence.ringIndex,
  );

  if (!Array.isArray(ring) || ring.length < 4) {
    return [];
  }

  const moveIndex = getRingMoveIndex(ring, occurrence.coordinateIndex);

  if (moveIndex < 0 || moveIndex >= ring.length - 1) {
    return [];
  }

  const lastIndex = ring.length - 1;
  const previousStartIndex = moveIndex === 0 ? lastIndex - 1 : moveIndex - 1;
  const previousEndIndex = moveIndex === 0 ? lastIndex : moveIndex;
  const nextStartIndex = moveIndex;
  const nextEndIndex = moveIndex + 1;

  return [
    {
      featureDguid: occurrence.featureDguid,
      polygonIndex: occurrence.polygonIndex,
      ringIndex: occurrence.ringIndex,
      ringLength: ring.length,
      segmentCount: ring.length - 1,
      segmentIndex: previousStartIndex,
      startIndex: previousStartIndex,
      endIndex: previousEndIndex,
      start: ring[previousStartIndex],
      end: ring[previousEndIndex],
    },
    {
      featureDguid: occurrence.featureDguid,
      polygonIndex: occurrence.polygonIndex,
      ringIndex: occurrence.ringIndex,
      ringLength: ring.length,
      segmentCount: ring.length - 1,
      segmentIndex: nextStartIndex,
      startIndex: nextStartIndex,
      endIndex: nextEndIndex,
      start: ring[nextStartIndex],
      end: ring[nextEndIndex],
    },
  ].filter((entry) => !coordinatesEqual(entry.start, entry.end));
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

function segmentsAreEquivalent(left, right) {
  return (
    (coordinatesEqual(left.start, right.start) && coordinatesEqual(left.end, right.end)) ||
    (coordinatesEqual(left.start, right.end) && coordinatesEqual(left.end, right.start))
  );
}

function segmentsAreAdjacent(left, right) {
  if (
    left.featureDguid !== right.featureDguid ||
    left.polygonIndex !== right.polygonIndex ||
    left.ringIndex !== right.ringIndex
  ) {
    return false;
  }

  if (left.segmentIndex === right.segmentIndex) {
    return true;
  }

  if (Math.abs(left.segmentIndex - right.segmentIndex) === 1) {
    return true;
  }

  return (
    (left.segmentIndex === 0 && right.segmentIndex === left.segmentCount - 1) ||
    (right.segmentIndex === 0 && left.segmentIndex === right.segmentCount - 1)
  );
}

function segmentsShareEndpoint(left, right) {
  return (
    coordinatesEqual(left.start, right.start) ||
    coordinatesEqual(left.start, right.end) ||
    coordinatesEqual(left.end, right.start) ||
    coordinatesEqual(left.end, right.end)
  );
}

function orientation(start, middle, end, epsilon = 1e-12) {
  const value =
    (middle[1] - start[1]) * (end[0] - middle[0]) -
    (middle[0] - start[0]) * (end[1] - middle[1]);

  if (Math.abs(value) <= epsilon) {
    return 0;
  }

  return value > 0 ? 1 : -1;
}

function segmentsConflict(left, right) {
  if (segmentsAreEquivalent(left, right)) {
    return false;
  }

  const endpointTouch = segmentsShareEndpoint(left, right);

  const o1 = orientation(left.start, left.end, right.start);
  const o2 = orientation(left.start, left.end, right.end);
  const o3 = orientation(right.start, right.end, left.start);
  const o4 = orientation(right.start, right.end, left.end);

  if (o1 !== o2 && o3 !== o4) {
    return !endpointTouch;
  }

  if (o1 === 0 && isPointOnSegment(right.start, left.start, left.end)) {
    return !endpointTouch;
  }

  if (o2 === 0 && isPointOnSegment(right.end, left.start, left.end)) {
    return !endpointTouch;
  }

  if (o3 === 0 && isPointOnSegment(left.start, right.start, right.end)) {
    return !endpointTouch;
  }

  if (o4 === 0 && isPointOnSegment(left.end, right.start, right.end)) {
    return !endpointTouch;
  }

  return false;
}

function isValidRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && coordinatesEqual(ring[0], ring[ring.length - 1]);
}

function isFeatureGeometryWithinAllowedRegion(allowedFeatures, feature) {
  let isValid = true;

  visitGeometryCoordinates(feature.geometry, ({ coordinate }) => {
    if (!isValid || isPointWithinFeatureSet(allowedFeatures, coordinate)) {
      return;
    }

    isValid = false;
  });

  if (!isValid) {
    return false;
  }

  visitGeometrySegments(getFeatureDguid(feature), feature.geometry, (segment) => {
    if (
      !isValid ||
      isSegmentWithinFeatureSet(
        allowedFeatures,
        segment.start,
        segment.end,
        getSegmentSampleCount(segment.start, segment.end),
      )
    ) {
      return;
    }

    isValid = false;
  });

  return isValid;
}

function isHandleMoveWithinAllowedRegion(cache, handle, nextCoordinate) {
  if (!cache || !handle || !Array.isArray(nextCoordinate)) {
    return false;
  }

  if (!isPointWithinFeatureSet(cache.originalFeatures, nextCoordinate)) {
    return false;
  }

  const nextCurrentFeatures = buildMovedCurrentFeatures(
    cache.currentFeatures,
    handle,
    nextCoordinate,
  );
  const featureLookup = new Map(
    nextCurrentFeatures.map((feature) => [getFeatureDguid(feature), feature]),
  );
  const changedSegments = [];

  for (const occurrence of handle.occurrences) {
    const feature = featureLookup.get(occurrence.featureDguid);

    if (!feature) {
      continue;
    }

    const ring = getRingReference(
      feature.geometry,
      occurrence.polygonIndex,
      occurrence.ringIndex,
    );

    if (!isValidRing(ring)) {
      return false;
    }

    changedSegments.push(...buildChangedSegmentEntries(feature, occurrence));
  }

  if (!changedSegments.length) {
    return false;
  }

  const allSegments = [];

  for (const feature of nextCurrentFeatures) {
    if (!isFeatureGeometryWithinAllowedRegion(cache.originalFeatures, feature)) {
      return false;
    }

    visitGeometrySegments(getFeatureDguid(feature), feature.geometry, (segment) => {
      allSegments.push(segment);
    });
  }

  if (allSegments.length === 0) {
    return false;
  }

  for (const changedSegment of changedSegments) {
    if (
      !isSegmentWithinFeatureSet(
        cache.originalFeatures,
        changedSegment.start,
        changedSegment.end,
        getSegmentSampleCount(changedSegment.start, changedSegment.end),
      )
    ) {
      return false;
    }

    for (const candidateSegment of allSegments) {
      if (
        segmentsAreAdjacent(changedSegment, candidateSegment) ||
        segmentsAreEquivalent(changedSegment, candidateSegment)
      ) {
        continue;
      }

      if (segmentsConflict(changedSegment, candidateSegment)) {
        return false;
      }
    }
  }

  return true;
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
