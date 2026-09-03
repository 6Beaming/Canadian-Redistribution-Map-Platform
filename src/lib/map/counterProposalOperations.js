const COORDINATE_PRECISION = 8;

function normalizeNumber(value) {
  return Number(value).toFixed(COORDINATE_PRECISION);
}

function coordinateKey(coordinate) {
  return `${normalizeNumber(coordinate[0])},${normalizeNumber(coordinate[1])}`;
}

function featureDguid(feature) {
  return String(feature?.properties?.DGUID ?? feature?.id ?? "");
}

function visitGeometryCoordinates(geometry, callback) {
  if (geometry?.type === "Polygon") {
    geometry.coordinates.forEach((ring, ringIndex) => {
      ring.forEach((coordinate, coordinateIndex) => {
        callback({ coordinate, polygonIndex: 0, ringIndex, coordinateIndex });
      });
    });
    return;
  }

  if (geometry?.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon, polygonIndex) => {
      polygon.forEach((ring, ringIndex) => {
        ring.forEach((coordinate, coordinateIndex) => {
          callback({ coordinate, polygonIndex, ringIndex, coordinateIndex });
        });
      });
    });
  }
}

function readCoordinateFromFeatures(features, handle) {
  if (!Array.isArray(features) || !handle?.occurrences?.length) {
    return Array.isArray(handle?.coordinate) ? [...handle.coordinate] : null;
  }

  const occurrence = handle.occurrences[0];
  const feature = features.find((entry) => featureDguid(entry) === occurrence.featureDguid);
  if (!feature?.geometry) {
    return Array.isArray(handle.coordinate) ? [...handle.coordinate] : null;
  }

  let resolved = null;
  visitGeometryCoordinates(feature.geometry, (entry) => {
    if (
      entry.polygonIndex === occurrence.polygonIndex
      && entry.ringIndex === occurrence.ringIndex
      && entry.coordinateIndex === occurrence.coordinateIndex
    ) {
      resolved = [...entry.coordinate];
    }
  });
  return resolved ?? (Array.isArray(handle.coordinate) ? [...handle.coordinate] : null);
}

export function normalizeCoordinateValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Number(number.toFixed(COORDINATE_PRECISION));
}

export function coordinatesEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  return coordinateKey(left) === coordinateKey(right);
}

export function buildBaseCoordinateMap(cache) {
  const map = new Map();
  const recorded = cache?.baselineCoordinatesByVertexId;
  if (recorded && typeof recorded === "object") {
    for (const [vertexId, coordinate] of Object.entries(recorded)) {
      if (!vertexId || !Array.isArray(coordinate) || coordinate.length < 2) {
        continue;
      }
      map.set(vertexId, [Number(coordinate[0]), Number(coordinate[1])]);
    }
  }
  for (const insertion of cache?.sourceBoundaryDensifications ?? []) {
    const vertexId = String(insertion?.vertexId ?? "").trim();
    if (!vertexId || map.has(vertexId) || !Array.isArray(insertion.coordinate)) {
      continue;
    }
    map.set(vertexId, [...insertion.coordinate]);
  }
  for (const handle of cache?.handles ?? []) {
    if (!handle?.vertexId || map.has(handle.vertexId)) {
      continue;
    }
    const base = readCoordinateFromFeatures(cache?.originalFeatures, handle);
    if (base) {
      map.set(handle.vertexId, base);
    }
  }
  return map;
}

function isSyntheticVertexId(vertexId) {
  const id = String(vertexId ?? "").trim();
  return (
    id.startsWith("bent-")
    || id.startsWith("release-midpoint-")
    || id.startsWith("release-interior-")
  );
}

function releaseCoordinateKey(coordinate) {
  return `${Number(coordinate[0]).toFixed(6)},${Number(coordinate[1]).toFixed(6)}`;
}

function lookupValues(lookup) {
  if (!lookup) {
    return [];
  }
  if (lookup instanceof Map) {
    return [...lookup.values()];
  }
  if (typeof lookup === "object") {
    return Object.values(lookup);
  }
  return [];
}

function lookupReleaseVertex(lookup, coordinate) {
  if (!lookup || !Array.isArray(coordinate)) {
    return null;
  }
  const key = releaseCoordinateKey(coordinate);
  if (lookup instanceof Map) {
    return lookup.get(key) ?? null;
  }
  if (typeof lookup === "object") {
    return lookup[key] ?? null;
  }
  return null;
}

function listUnlockableCatalogVertices(cache) {
  const byId = new Map();
  const add = (entry) => {
    const vertexId = String(entry?.vertexId ?? "").trim();
    if (!vertexId || isSyntheticVertexId(vertexId) || entry?.locked) {
      return;
    }
    if (byId.has(vertexId)) {
      return;
    }
    byId.set(vertexId, {
      vertexId,
      coordinate: Array.isArray(entry.coordinate) ? [...entry.coordinate] : null,
      arcId: entry.arcId ?? null,
    });
  };
  (cache?.catalogVertices ?? []).forEach(add);
  (cache?.handles ?? []).forEach(add);
  lookupValues(cache?.releaseVertexByCoordinate).forEach(add);
  return [...byId.values()];
}

function resolveSubmittableVertexId(cache, handle, baseCoordinate) {
  const directId = String(handle?.vertexId ?? "").trim();
  if (directId && !isSyntheticVertexId(directId)) {
    return directId;
  }
  const lookupCoordinate = Array.isArray(baseCoordinate)
    ? baseCoordinate
    : handle?.coordinate;
  if (!Array.isArray(lookupCoordinate)) {
    return null;
  }
  const releaseVertex = lookupReleaseVertex(
    cache?.releaseVertexByCoordinate,
    lookupCoordinate,
  );
  if (releaseVertex?.vertexId && !releaseVertex.locked && !isSyntheticVertexId(releaseVertex.vertexId)) {
    return String(releaseVertex.vertexId).trim();
  }
  const handleArcId = handle?.arcId ?? null;
  const candidates = listUnlockableCatalogVertices(cache).filter((entry) => (
    Array.isArray(entry.coordinate)
    && (!handleArcId || !entry.arcId || String(entry.arcId) === String(handleArcId))
  ));
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of candidates) {
    const distance = Math.hypot(
      Number(entry.coordinate[0]) - Number(lookupCoordinate[0]),
      Number(entry.coordinate[1]) - Number(lookupCoordinate[1]),
    );
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best?.vertexId ?? null;
}

function emitDirtyOperation(dirty, vertexId, coordinate) {
  if (!vertexId || !Array.isArray(coordinate) || dirty.has(vertexId)) {
    return;
  }
  const toLng = normalizeCoordinateValue(coordinate[0]);
  const toLat = normalizeCoordinateValue(coordinate[1]);
  if (toLng === null || toLat === null) {
    return;
  }
  dirty.set(vertexId, { vertexId, toLng, toLat });
}

function findHandleById(cache, handleId) {
  return (cache?.handles ?? []).find((entry) => (
    entry.id === handleId || entry.legacyId === handleId
  )) ?? null;
}

export function rebuildDirtyOperations(cache, baseCoordinateByVertexId) {
  const dirty = new Map();
  for (const handle of cache?.handles ?? []) {
    if (!handle?.vertexId || handle.locked) {
      continue;
    }
    const currentCandidates = [
      Array.isArray(handle.coordinate) ? handle.coordinate : null,
      readCoordinateFromFeatures(cache?.currentFeatures, handle),
    ].filter((coordinate) => Array.isArray(coordinate));
    const base = baseCoordinateByVertexId.get(handle.vertexId)
      ?? readCoordinateFromFeatures(cache?.originalFeatures, handle);
    const current = currentCandidates.find((coordinate) => !coordinatesEqual(base, coordinate))
      ?? currentCandidates[0];
    if (!base || !current || coordinatesEqual(base, current)) {
      continue;
    }
    const vertexId = resolveSubmittableVertexId(cache, handle, base);
    if (!vertexId) {
      continue;
    }
    emitDirtyOperation(dirty, vertexId, current);
  }
  for (const operation of cache?.history ?? []) {
    if (operation?.type !== "move-handle" || !operation.handleId || !Array.isArray(operation.to)) {
      continue;
    }
    const handle = findHandleById(cache, operation.handleId);
    if (!handle || handle.locked) {
      continue;
    }
    const vertexId = resolveSubmittableVertexId(
      cache,
      handle,
      operation.from ?? baseCoordinateByVertexId.get(handle.vertexId),
    );
    if (!vertexId) {
      continue;
    }
    const base = baseCoordinateByVertexId.get(vertexId)
      ?? operation.from
      ?? readCoordinateFromFeatures(cache?.originalFeatures, handle);
    if (!base || coordinatesEqual(base, operation.to)) {
      continue;
    }
    emitDirtyOperation(dirty, vertexId, operation.to);
  }
  return dirty;
}

export function initializeWorkerOperationState(cache) {
  return {
    releaseIdentity: cache?.releaseIdentity ?? null,
    baseCoordinateByVertexId: buildBaseCoordinateMap(cache),
    dirtyOperationsByVertexId: new Map(),
  };
}

export function syncWorkerOperationState(state, cache) {
  if (!state || !cache) {
    return;
  }
  if (!state.baseCoordinateByVertexId?.size) {
    state.baseCoordinateByVertexId = buildBaseCoordinateMap(cache);
  } else {
    for (const handle of cache.handles ?? []) {
      if (!handle?.vertexId || state.baseCoordinateByVertexId.has(handle.vertexId)) {
        continue;
      }
      const recorded = cache.baselineCoordinatesByVertexId?.[handle.vertexId];
      const base = readCoordinateFromFeatures(cache.originalFeatures, handle)
        ?? (Array.isArray(recorded) ? [...recorded] : null);
      if (base) {
        state.baseCoordinateByVertexId.set(handle.vertexId, base);
      }
    }
  }
  state.dirtyOperationsByVertexId = rebuildDirtyOperations(cache, state.baseCoordinateByVertexId);
}

export function exportSubmissionOperations(state, cache) {
  syncWorkerOperationState(state, cache);
  const operations = [...(state.dirtyOperationsByVertexId?.values() ?? [])]
    .sort((left, right) => left.vertexId.localeCompare(right.vertexId));

  return {
    releaseId: state.releaseIdentity?.releaseId ?? cache?.releaseIdentity?.releaseId ?? null,
    baseRevision: state.releaseIdentity?.baseRevision ?? cache?.releaseIdentity?.baseRevision ?? null,
    primaryDguid: cache?.firstDguid ?? null,
    secondaryDguid: cache?.secondDguid ?? null,
    operations,
    clientDiagnostics: {
      impactSummary: cache?.impacts ?? null,
      valid: operations.length > 0,
    },
  };
}
