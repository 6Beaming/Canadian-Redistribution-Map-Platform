export const MAX_EDITABLE_HANDLES_PER_KM = 2;
export const MIN_EDITABLE_HANDLES_PER_BOUNDARY = 2;
export const MIN_HANDLE_SPACING_METERS = 500;
export const MIN_HANDLE_SPACING_PX = 40;
export const STRAIGHT_RUN_ANGLE_TOLERANCE_DEGREES = 12;
export const STRAIGHT_RUN_MAX_DEVIATION_METERS = 35;

const EARTH_RADIUS_METERS = 6371008.8;

function coordinateKey(coordinate) {
  return `${Number(coordinate[0]).toFixed(6)},${Number(coordinate[1]).toFixed(6)}`;
}

function compareCoordinates(left, right) {
  return coordinateKey(left).localeCompare(coordinateKey(right));
}

export function distanceMeters(left, right) {
  const toRadians = (value) => Number(value) * Math.PI / 180;
  const lat1 = toRadians(left[1]);
  const lat2 = toRadians(right[1]);
  const dLat = lat2 - lat1;
  const dLng = toRadians(right[0]) - toRadians(left[0]);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

function visitGeometryCoordinates(geometry, callback) {
  if (geometry?.type === "Polygon") {
    geometry.coordinates.forEach((ring, ringIndex) => ring.forEach((coordinate, coordinateIndex) =>
      callback({ coordinate, polygonIndex: 0, ringIndex, coordinateIndex })));
  } else if (geometry?.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon, polygonIndex) => polygon.forEach((ring, ringIndex) =>
      ring.forEach((coordinate, coordinateIndex) =>
        callback({ coordinate, polygonIndex, ringIndex, coordinateIndex }))));
  }
}

function featureDguid(feature) {
  return String(feature?.properties?.DGUID ?? feature?.id ?? "");
}

function buildOrderedChains(boundaryGeoJson) {
  const edges = (boundaryGeoJson?.features ?? []).flatMap((feature) => {
    const lines = feature.geometry?.type === "LineString"
      ? [feature.geometry.coordinates]
      : feature.geometry?.type === "MultiLineString"
        ? feature.geometry.coordinates
        : [];
    return lines.flatMap((coordinates) =>
      coordinates.slice(0, -1).map((start, index) => ({ start, end: coordinates[index + 1] }))
        .filter((edge) => coordinateKey(edge.start) !== coordinateKey(edge.end)));
  });
  const adjacency = new Map();
  edges.forEach((edge, edgeIndex) => {
    [edge.start, edge.end].forEach((coordinate) => {
      const key = coordinateKey(coordinate);
      if (!adjacency.has(key)) adjacency.set(key, []);
      adjacency.get(key).push(edgeIndex);
    });
  });
  const unused = new Set(edges.map((_, index) => index));
  const chains = [];
  while (unused.size) {
    const componentEdge = edges[[...unused][0]];
    const endpointCandidates = [...adjacency.entries()]
      .filter(([, ids]) => ids.some((id) => unused.has(id)) && ids.length !== 2)
      .map(([key]) => key.split(",").map(Number));
    if (!endpointCandidates.length) endpointCandidates.push(componentEdge.start, componentEdge.end);
    let current = endpointCandidates.sort(compareCoordinates)[0];
    const chain = [current];
    while (true) {
      const candidates = (adjacency.get(coordinateKey(current)) ?? []).filter((id) => unused.has(id));
      if (!candidates.length) break;
      if (chain.length > 1 && (adjacency.get(coordinateKey(current)) ?? []).length !== 2) break;
      candidates.sort((left, right) => {
        const leftEdge = edges[left];
        const rightEdge = edges[right];
        const other = (edge) => coordinateKey(edge.start) === coordinateKey(current) ? edge.end : edge.start;
        return compareCoordinates(other(leftEdge), other(rightEdge));
      });
      const edgeIndex = candidates[0];
      unused.delete(edgeIndex);
      const edge = edges[edgeIndex];
      current = coordinateKey(edge.start) === coordinateKey(current) ? edge.end : edge.start;
      chain.push(current);
    }
    if (chain.length > 1) chains.push(chain);
  }
  return chains.sort((left, right) => compareCoordinates(left[0], right[0]));
}

export function getSharedBoundaryChains(boundaryGeoJson) {
  return buildOrderedChains(boundaryGeoJson).map((chain) =>
    chain.map((coordinate) => [...coordinate]));
}

function turnAngleDegrees(previous, current, next) {
  const a = [previous[0] - current[0], previous[1] - current[1]];
  const b = [next[0] - current[0], next[1] - current[1]];
  const magnitude = Math.hypot(...a) * Math.hypot(...b);
  if (!magnitude) return 0;
  const cosine = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / magnitude));
  return 180 - Math.acos(cosine) * 180 / Math.PI;
}

function pointSegmentDistanceMeters(point, start, end) {
  const scale = Math.cos(Number(point[1]) * Math.PI / 180);
  const toLocal = (coordinate) => [
    (Number(coordinate[0]) - Number(start[0])) * 111320 * scale,
    (Number(coordinate[1]) - Number(start[1])) * 110540,
  ];
  const p = toLocal(point);
  const e = toLocal(end);
  const lengthSquared = e[0] ** 2 + e[1] ** 2;
  if (!lengthSquared) return Math.hypot(...p);
  const t = Math.max(0, Math.min(1, (p[0] * e[0] + p[1] * e[1]) / lengthSquared));
  return Math.hypot(p[0] - t * e[0], p[1] - t * e[1]);
}

function isStraightChain(chain) {
  if (chain.length <= 2) return true;
  return chain.slice(1, -1).every((coordinate, index) =>
    turnAngleDegrees(chain[index], coordinate, chain[index + 2]) <= STRAIGHT_RUN_ANGLE_TOLERANCE_DEGREES
    && pointSegmentDistanceMeters(coordinate, chain[0], chain.at(-1)) <= STRAIGHT_RUN_MAX_DEVIATION_METERS);
}

function selectVisibleIndexes(chain, project, hasOccurrences = () => true) {
  const selected = new Set([0, chain.length - 1]);
  const required = new Set([0, chain.length - 1]);
  chain.slice(1, -1).forEach((coordinate, offset) => {
    const index = offset + 1;
    if (turnAngleDegrees(chain[index - 1], coordinate, chain[index + 1]) > STRAIGHT_RUN_ANGLE_TOLERANCE_DEGREES) {
      required.add(index);
      selected.add(index);
    }
  });
  const straight = isStraightChain(chain);
  const length = chain.slice(1).reduce((sum, coordinate, index) => sum + distanceMeters(chain[index], coordinate), 0);
  const straightBudget = Math.ceil(length / 1000) + 1;
  let lastSelected = 0;
  for (let index = 1; index < chain.length - 1; index += 1) {
    if (required.has(index)) {
      lastSelected = index;
      continue;
    }
    if (straight && selected.size >= straightBudget) continue;
    if (distanceMeters(chain[lastSelected], chain[index]) < MIN_HANDLE_SPACING_METERS) continue;
    if (distanceMeters(chain[index], chain.at(-1)) < MIN_HANDLE_SPACING_METERS) continue;
    if (project) {
      const left = project(chain[lastSelected]);
      const right = project(chain[index]);
      if (Math.hypot(right.x - left.x, right.y - left.y) < MIN_HANDLE_SPACING_PX) continue;
    }
    selected.add(index);
    lastSelected = index;
  }

  const isEditableIndex = (index) =>
    index > 0 && index < chain.length - 1 && hasOccurrences(chain[index]);
  const targetEditableHandles = Math.min(
    MIN_EDITABLE_HANDLES_PER_BOUNDARY,
    Math.max(0, chain.length - 2),
  );

  while ([...selected].filter(isEditableIndex).length < targetEditableHandles) {
    const fallbackIndex = chain
      .slice(1, -1)
      .map((_, offset) => offset + 1)
      .filter((index) => !selected.has(index) && isEditableIndex(index))
      .map((index) => ({
        index,
        clearance: Math.min(
          ...[...selected].map((selectedIndex) =>
            distanceMeters(chain[selectedIndex], chain[index])),
        ),
      }))
      .sort((left, right) => right.clearance - left.clearance || left.index - right.index)[0]?.index;

    if (fallbackIndex === undefined) break;
    selected.add(fallbackIndex);
    required.add(fallbackIndex);
  }

  return { selected, required, straight, length };
}

export function buildSharedBoundaryHandles(features, boundaryGeoJson, { project } = {}) {
  const occurrenceByCoordinate = new Map();
  features.forEach((feature) => {
    const dguid = featureDguid(feature);
    visitGeometryCoordinates(feature.geometry, (entry) => {
      const key = coordinateKey(entry.coordinate);
      if (!occurrenceByCoordinate.has(key)) occurrenceByCoordinate.set(key, []);
      occurrenceByCoordinate.get(key).push({
        featureDguid: dguid,
        polygonIndex: entry.polygonIndex,
        ringIndex: entry.ringIndex,
        coordinateIndex: entry.coordinateIndex,
      });
    });
  });
  const diagnostics = [];
  const handles = [];
  getSharedBoundaryChains(boundaryGeoJson).forEach((chain, chainIndex) => {
    const occursInBothFeatures = (coordinate) => {
      const dguids = new Set(
        (occurrenceByCoordinate.get(coordinateKey(coordinate)) ?? [])
          .map((occurrence) => occurrence.featureDguid),
      );
      return features.every((feature) => dguids.has(featureDguid(feature)));
    };
    const { selected, required, straight, length } = selectVisibleIndexes(
      chain,
      project,
      occursInBothFeatures,
    );
    diagnostics.push({
      chainId: `line-${chainIndex}`,
      lengthMeters: length,
      straight,
      canonicalVertices: chain.length,
      visibleHandles: selected.size,
      requiredHandles: required.size,
      requiredDensityExceeded: required.size > Math.max(2, Math.ceil(length / 1000) * MAX_EDITABLE_HANDLES_PER_KM + 1),
    });
    [...selected].sort((a, b) => a - b).forEach((vertexIndex) => {
      const coordinate = chain[vertexIndex];
      const occurrences = occurrenceByCoordinate.get(coordinateKey(coordinate)) ?? [];
      if (!occurrences.length) return;
      handles.push({
        id: `line-${chainIndex}:vertex-${vertexIndex}`,
        legacyId: coordinateKey(coordinate),
        lineId: `line-${chainIndex}`,
        segmentIndex: Math.max(0, vertexIndex - 1),
        coordinate: [...coordinate],
        locked: vertexIndex === 0 || vertexIndex === chain.length - 1,
        required: required.has(vertexIndex),
        featureDguids: [...new Set(occurrences.map((entry) => entry.featureDguid))],
        occurrences,
      });
    });
  });
  Object.defineProperty(handles, "diagnostics", { value: diagnostics, enumerable: false });
  return handles;
}

export function filterHandlesForViewport(handles, project) {
  if (typeof project !== "function") return handles;
  const visible = [];
  let lastPoint = null;
  handles.forEach((handle) => {
    const point = project(handle.coordinate);
    if (handle.required || handle.locked || handle.selected || !lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= MIN_HANDLE_SPACING_PX) {
      visible.push(handle);
      lastPoint = point;
    }
  });
  return visible;
}

export function filterHandleFeatureCollectionForViewport(featureCollection, project) {
  const features = Array.isArray(featureCollection?.features) ? featureCollection.features : [];
  const handles = features.map((feature) => ({
    feature,
    coordinate: feature.geometry?.coordinates,
    required: Boolean(feature.properties?.required),
    locked: Boolean(feature.properties?.locked),
    selected: Boolean(feature.properties?.selected),
  })).filter((handle) => Array.isArray(handle.coordinate));
  return {
    type: "FeatureCollection",
    features: filterHandlesForViewport(handles, project).map((handle) => handle.feature),
  };
}
