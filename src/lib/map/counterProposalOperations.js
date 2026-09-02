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
  for (const handle of cache?.handles ?? []) {
    if (!handle?.vertexId) {
      continue;
    }
    const base = readCoordinateFromFeatures(cache?.originalFeatures, handle);
    if (base) {
      map.set(handle.vertexId, base);
    }
  }
  return map;
}

export function rebuildDirtyOperations(cache, baseCoordinateByVertexId) {
  const dirty = new Map();
  for (const handle of cache?.handles ?? []) {
    if (!handle?.vertexId || handle.locked) {
      continue;
    }
    const base = baseCoordinateByVertexId.get(handle.vertexId);
    if (!base || !Array.isArray(handle.coordinate)) {
      continue;
    }
    if (coordinatesEqual(base, handle.coordinate)) {
      continue;
    }
    const toLng = normalizeCoordinateValue(handle.coordinate[0]);
    const toLat = normalizeCoordinateValue(handle.coordinate[1]);
    if (toLng === null || toLat === null) {
      continue;
    }
    dirty.set(handle.vertexId, { vertexId: handle.vertexId, toLng, toLat });
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
