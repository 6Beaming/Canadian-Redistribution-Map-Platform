import { getPairOuterBoundaryFeatureCollection } from "./objectionWorkflow.js";

const INTERSECTION_EPSILON = 1e-9;

function normalizeNumber(value) {
  return Number(value).toFixed(6);
}

function coordinateKey(coordinate) {
  return `${normalizeNumber(coordinate[0])},${normalizeNumber(coordinate[1])}`;
}

function segmentKey(start, end) {
  const left = coordinateKey(start);
  const right = coordinateKey(end);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

export function coordinatesEqual(left, right, epsilon = 1e-9) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  return (
    Math.abs(Number(left[0]) - Number(right[0])) <= epsilon
    && Math.abs(Number(left[1]) - Number(right[1])) <= epsilon
  );
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

function collectOutlineVertexKeys(originalFeatures) {
  const keys = new Set();

  originalFeatures.forEach((feature) => {
    visitGeometryRings(feature.geometry, (ring) => {
      ring.forEach((coordinate) => keys.add(coordinateKey(coordinate)));
    });
  });

  return keys;
}

function collectOuterBoundaryVertexKeys(cache) {
  const keys = new Set();
  const outerBoundary = getPairOuterBoundaryFeatureCollection(
    cache.pairIndex,
    [cache.firstDguid, cache.secondDguid],
  );

  outerBoundary.features.forEach((feature) => {
    const coordinates = feature.geometry?.coordinates ?? [];
    coordinates.forEach((coordinate) => keys.add(coordinateKey(coordinate)));
  });

  return keys;
}

function isPointOnOuterBoundary(cache, coordinate) {
  return collectOuterBoundaryVertexKeys(cache).has(coordinateKey(coordinate));
}

function isPointOnOriginalOutline(originalFeatures, coordinate) {
  return collectOutlineVertexKeys(originalFeatures).has(coordinateKey(coordinate));
}

function findHandleAtCoordinate(handles, coordinate) {
  return handles.find((handle) => coordinatesEqual(handle.coordinate, coordinate)) ?? null;
}

/**
 * Border point: on the original DA outline, excluding unlocked handles on the same
 * shared boundary chain as the handle being moved. Locked endpoints remain anchors.
 */
export function isBorderAnchor(cache, coordinate, movingHandle) {
  if (!cache || !movingHandle || !Array.isArray(coordinate)) {
    return false;
  }

  if (coordinatesEqual(coordinate, movingHandle.coordinate)) {
    return false;
  }

  const onOriginalOutline = isPointOnOriginalOutline(cache.originalFeatures, coordinate);
  const onOuterBoundary = isPointOnOuterBoundary(cache, coordinate);

  if (!onOriginalOutline && !onOuterBoundary) {
    return false;
  }

  const handle = findHandleAtCoordinate(cache.handles ?? [], coordinate);

  if (!handle) {
    return true;
  }

  if (handle.id === movingHandle.id) {
    return false;
  }

  if (handle.lineId !== movingHandle.lineId) {
    return true;
  }

  return Boolean(handle.locked);
}

export function hasProperSegmentIntersection(aStart, aEnd, bStart, bEnd) {
  const denominator = ((bEnd[1] - bStart[1]) * (aEnd[0] - aStart[0]))
    - ((bEnd[0] - bStart[0]) * (aEnd[1] - aStart[1]));

  if (Math.abs(denominator) <= 1e-14) {
    return false;
  }

  const ua = (
    ((bEnd[0] - bStart[0]) * (aStart[1] - bStart[1]))
    - ((bEnd[1] - bStart[1]) * (aStart[0] - bStart[0]))
  ) / denominator;
  const ub = (
    ((aEnd[0] - aStart[0]) * (aStart[1] - bStart[1]))
    - ((aEnd[1] - aStart[1]) * (aStart[0] - bStart[0]))
  ) / denominator;

  return (
    ua > INTERSECTION_EPSILON
    && ua < 1 - INTERSECTION_EPSILON
    && ub > INTERSECTION_EPSILON
    && ub < 1 - INTERSECTION_EPSILON
  );
}

function interpolateCoordinate(start, end, ratio) {
  return [
    start[0] + ((end[0] - start[0]) * ratio),
    start[1] + ((end[1] - start[1]) * ratio),
  ];
}

function segmentIntersectionParameters(aStart, aEnd, bStart, bEnd) {
  const denominator = ((bEnd[1] - bStart[1]) * (aEnd[0] - aStart[0]))
    - ((bEnd[0] - bStart[0]) * (aEnd[1] - aStart[1]));

  if (Math.abs(denominator) <= 1e-14) {
    return null;
  }

  const ua = (
    ((bEnd[0] - bStart[0]) * (aStart[1] - bStart[1]))
    - ((bEnd[1] - bStart[1]) * (aStart[0] - bStart[0]))
  ) / denominator;
  const ub = (
    ((aEnd[0] - aStart[0]) * (aStart[1] - bStart[1]))
    - ((aEnd[1] - aStart[1]) * (aStart[0] - bStart[0]))
  ) / denominator;

  return { ua, ub };
}

function intersectionPoint(aStart, aEnd, parameters) {
  return interpolateCoordinate(aStart, aEnd, parameters.ua);
}

function isAllowedTouchPoint(point, allowedTouchKeys) {
  return allowedTouchKeys.has(coordinateKey(point));
}

function segmentsMeetAwayFromAllowedTouches(
  aStart,
  aEnd,
  bStart,
  bEnd,
  allowedTouchKeys,
) {
  const parameters = segmentIntersectionParameters(aStart, aEnd, bStart, bEnd);

  if (!parameters) {
    return false;
  }

  const { ua, ub } = parameters;

  if (
    ua < -INTERSECTION_EPSILON
    || ua > 1 + INTERSECTION_EPSILON
    || ub < -INTERSECTION_EPSILON
    || ub > 1 + INTERSECTION_EPSILON
  ) {
    return false;
  }

  if (ua <= INTERSECTION_EPSILON) {
    return false;
  }

  const point = intersectionPoint(aStart, aEnd, parameters);

  return !isAllowedTouchPoint(point, allowedTouchKeys);
}

function collectPairOuterBoundarySegments(cache) {
  const outerBoundary = getPairOuterBoundaryFeatureCollection(
    cache.pairIndex,
    [cache.firstDguid, cache.secondDguid],
  );

  return outerBoundary.features.flatMap((feature) => {
    const coordinates = feature.geometry?.coordinates ?? [];
    const segments = [];

    for (let index = 0; index < coordinates.length - 1; index += 1) {
      if (coordinatesEqual(coordinates[index], coordinates[index + 1])) {
        continue;
      }

      segments.push({
        start: [...coordinates[index]],
        end: [...coordinates[index + 1]],
      });
    }

    return segments;
  });
}

function collectSharedBoundarySegmentKeys(cache) {
  const keys = new Set();
  const pairKey = [String(cache.firstDguid), String(cache.secondDguid)].sort().join("|");
  const segments = cache.pairIndex?.boundarySegmentsByPair?.get(pairKey) ?? [];

  segments.forEach((segment) => {
    if (!Array.isArray(segment) || segment.length < 2) {
      return;
    }

    keys.add(segmentKey(segment[0], segment[1]));
  });

  return keys;
}

function collectRingSegments(ring) {
  const segments = [];

  if (!Array.isArray(ring) || ring.length < 2) {
    return segments;
  }

  for (let index = 0; index < ring.length - 1; index += 1) {
    if (coordinatesEqual(ring[index], ring[index + 1])) {
      continue;
    }

    segments.push({
      start: [...ring[index]],
      end: [...ring[index + 1]],
    });
  }

  return segments;
}

function collectAllFeatureSegments(features) {
  const segments = [];

  features.forEach((feature) => {
    visitGeometryRings(feature.geometry, (ring) => {
      collectRingSegments(ring).forEach((segment) => segments.push(segment));
    });
  });

  return segments;
}

function ringHasSelfIntersection(ring) {
  const segments = collectRingSegments(ring);

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      if (rightIndex === leftIndex + 1) {
        continue;
      }

      if (leftIndex === 0 && rightIndex === segments.length - 1) {
        continue;
      }

      const left = segments[leftIndex];
      const right = segments[rightIndex];
      const allowedTouchKeys = new Set([
        coordinateKey(left.start),
        coordinateKey(left.end),
        coordinateKey(right.start),
        coordinateKey(right.end),
      ]);

      if (editedSegmentConflictsWithContour(
        left.start,
        left.end,
        right.start,
        right.end,
        allowedTouchKeys,
      )) {
        return true;
      }
    }
  }

  return false;
}

function hasSimpleMovedGeometry(nextFeatures) {
  for (const feature of nextFeatures) {
    let hasInvalidRing = false;

    visitGeometryRings(feature.geometry, (ring) => {
      if (hasInvalidRing) {
        return;
      }

      if (ringHasSelfIntersection(ring)) {
        hasInvalidRing = true;
      }
    });

    if (hasInvalidRing) {
      return false;
    }
  }

  return true;
}

function isModifiedSegment(segment, modifiedSegments) {
  const key = segmentKey(segment.start, segment.end);

  return modifiedSegments.some((candidate) =>
    segmentKey(candidate.start, candidate.end) === key);
}

function modifiedSegmentConflictsWithCurrentGeometry(
  modifiedSegments,
  nextFeatures,
  nextCoordinate,
) {
  const allSegments = collectAllFeatureSegments(nextFeatures);

  for (const segment of modifiedSegments) {
    const fixedEndpoint = coordinatesEqual(segment.start, nextCoordinate)
      ? segment.end
      : segment.start;
    const allowedTouchKeys = new Set([coordinateKey(fixedEndpoint)]);

    for (const candidate of allSegments) {
      if (isModifiedSegment(candidate, modifiedSegments)) {
        continue;
      }

      if (editedSegmentConflictsWithContour(
        segment.start,
        segment.end,
        candidate.start,
        candidate.end,
        allowedTouchKeys,
      )) {
        return true;
      }
    }
  }

  return false;
}

function collectOriginalIncidentSegments(originalFeatures, handle) {
  const segments = new Set();

  handle.occurrences.forEach((occurrence) => {
    const feature = originalFeatures.find(
      (entry) => String(entry?.properties?.DGUID ?? entry?.id ?? "") === occurrence.featureDguid,
    );
    const geometry = feature?.geometry;

    if (!geometry) {
      return;
    }

    let ring = null;

    if (geometry.type === "Polygon") {
      ring = geometry.coordinates?.[occurrence.ringIndex] ?? null;
    } else if (geometry.type === "MultiPolygon") {
      ring = geometry.coordinates?.[occurrence.polygonIndex]?.[occurrence.ringIndex] ?? null;
    }

    if (!ring?.[occurrence.coordinateIndex]) {
      return;
    }

    const previous = ring[occurrence.coordinateIndex - 1];
    const next = ring[occurrence.coordinateIndex + 1];

    if (previous) {
      segments.add(segmentKey(previous, handle.coordinate));
    }

    if (next) {
      segments.add(segmentKey(handle.coordinate, next));
    }
  });

  return segments;
}

function collectExcludedOriginalSharedBoundarySegments(originalFeatures, handle, cache) {
  const incidentSegments = collectOriginalIncidentSegments(originalFeatures, handle);
  const sharedBoundarySegmentKeys = collectSharedBoundarySegmentKeys(cache);
  const excluded = new Set();

  incidentSegments.forEach((key) => {
    if (sharedBoundarySegmentKeys.has(key)) {
      excluded.add(key);
    }
  });

  return excluded;
}

function projectParamOnSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = (dx * dx) + (dy * dy);

  if (lengthSquared <= 1e-24) {
    return null;
  }

  return (
    ((point[0] - start[0]) * dx)
    + ((point[1] - start[1]) * dy)
  ) / lengthSquared;
}

function segmentsAreCollinear(aStart, aEnd, bStart, bEnd) {
  const crossBStart = ((bStart[0] - aStart[0]) * (aEnd[1] - aStart[1]))
    - ((bStart[1] - aStart[1]) * (aEnd[0] - aStart[0]));
  const crossBEnd = ((bEnd[0] - aStart[0]) * (aEnd[1] - aStart[1]))
    - ((bEnd[1] - aStart[1]) * (aEnd[0] - aStart[0]));

  return Math.abs(crossBStart) <= 1e-10 && Math.abs(crossBEnd) <= 1e-10;
}

function collinearSegmentsOverlapInterior(
  aStart,
  aEnd,
  bStart,
  bEnd,
  allowedTouchKeys,
) {
  if (!segmentsAreCollinear(aStart, aEnd, bStart, bEnd)) {
    return false;
  }

  let tb0 = projectParamOnSegment(bStart, aStart, aEnd);
  let tb1 = projectParamOnSegment(bEnd, aStart, aEnd);

  if (tb0 === null || tb1 === null) {
    return false;
  }

  if (tb0 > tb1) {
    [tb0, tb1] = [tb1, tb0];
  }

  const overlapStart = Math.max(0, tb0);
  const overlapEnd = Math.min(1, tb1);

  if (overlapEnd - overlapStart <= INTERSECTION_EPSILON) {
    return false;
  }

  const interiorStart = overlapStart + INTERSECTION_EPSILON;
  const interiorEnd = overlapEnd - INTERSECTION_EPSILON;

  if (interiorStart >= interiorEnd) {
    return false;
  }

  const interiorPoint = interpolateCoordinate(
    aStart,
    aEnd,
    (interiorStart + interiorEnd) / 2,
  );

  return !isAllowedTouchPoint(interiorPoint, allowedTouchKeys);
}

function editedSegmentConflictsWithContour(
  editedStart,
  editedEnd,
  contourStart,
  contourEnd,
  allowedTouchKeys,
) {
  if (hasProperSegmentIntersection(editedStart, editedEnd, contourStart, contourEnd)) {
    return true;
  }

  if (segmentsMeetAwayFromAllowedTouches(
    editedStart,
    editedEnd,
    contourStart,
    contourEnd,
    allowedTouchKeys,
  )) {
    return true;
  }

  return collinearSegmentsOverlapInterior(
    editedStart,
    editedEnd,
    contourStart,
    contourEnd,
    allowedTouchKeys,
  );
}

export function getIncidentSegmentsForHandleMove(handle, nextCoordinate, nextFeatures) {
  const modified = [];
  const seen = new Set();

  const remember = (start, end) => {
    if (coordinatesEqual(start, end)) {
      return;
    }

    const key = segmentKey(start, end);

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    modified.push({ start: [...start], end: [...end] });
  };

  handle.occurrences.forEach((occurrence) => {
    const feature = nextFeatures.find(
      (entry) => String(entry?.properties?.DGUID ?? entry?.id ?? "") === occurrence.featureDguid,
    );
    const geometry = feature?.geometry;

    if (!geometry) {
      return;
    }

    let ring = null;

    if (geometry.type === "Polygon") {
      ring = geometry.coordinates?.[occurrence.ringIndex] ?? null;
    } else if (geometry.type === "MultiPolygon") {
      ring = geometry.coordinates?.[occurrence.polygonIndex]?.[occurrence.ringIndex] ?? null;
    }

    if (!ring?.[occurrence.coordinateIndex]) {
      return;
    }

    const previous = ring[occurrence.coordinateIndex - 1];
    const next = ring[occurrence.coordinateIndex + 1];

    if (previous) {
      remember(previous, nextCoordinate);
    }

    if (next) {
      remember(nextCoordinate, next);
    }
  });

  return modified;
}

function modifiedSegmentsSelfIntersect(modifiedSegments, nextCoordinate) {
  if (modifiedSegments.length < 2) {
    return false;
  }

  const allowedTouchKeys = new Set([coordinateKey(nextCoordinate)]);

  for (let leftIndex = 0; leftIndex < modifiedSegments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < modifiedSegments.length; rightIndex += 1) {
      const left = modifiedSegments[leftIndex];
      const right = modifiedSegments[rightIndex];

      if (editedSegmentConflictsWithContour(
        left.start,
        left.end,
        right.start,
        right.end,
        allowedTouchKeys,
      )) {
        return true;
      }
    }
  }

  return false;
}

export function hasValidAnchoredBoundarySegments(cache, handle, nextCoordinate, nextFeatures) {
  const modifiedSegments = getIncidentSegmentsForHandleMove(handle, nextCoordinate, nextFeatures);

  if (!modifiedSegments.length) {
    return true;
  }

  if (!hasSimpleMovedGeometry(nextFeatures)) {
    return false;
  }

  if (modifiedSegmentsSelfIntersect(modifiedSegments, nextCoordinate)) {
    return false;
  }

  const excludedOriginalSegments = collectExcludedOriginalSharedBoundarySegments(
    cache.originalFeatures,
    handle,
    cache,
  );
  const outlineSegments = collectAllFeatureSegments(cache.originalFeatures);
  const outerBoundarySegments = collectPairOuterBoundarySegments(cache);

  if (modifiedSegmentConflictsWithCurrentGeometry(
    modifiedSegments,
    nextFeatures,
    nextCoordinate,
  )) {
    return false;
  }

  for (const segment of modifiedSegments) {
    const fixedEndpoint = coordinatesEqual(segment.start, nextCoordinate)
      ? segment.end
      : segment.start;
    const allowedTouchKeys = new Set([
      coordinateKey(fixedEndpoint),
    ]);

    const contourSegments = [...outlineSegments, ...outerBoundarySegments];

    for (const outlineSegment of contourSegments) {
      const outlineKey = segmentKey(outlineSegment.start, outlineSegment.end);

      if (excludedOriginalSegments.has(outlineKey)) {
        continue;
      }

      if (editedSegmentConflictsWithContour(
        segment.start,
        segment.end,
        outlineSegment.start,
        outlineSegment.end,
        allowedTouchKeys,
      )) {
        return false;
      }
    }
  }

  return true;
}
