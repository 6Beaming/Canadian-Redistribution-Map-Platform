function normalizeNumber(value) {
  return Number(value).toFixed(6);
}

function coordinateKey(coordinate) {
  return `${normalizeNumber(coordinate[0])},${normalizeNumber(coordinate[1])}`;
}

function edgeKey(start, end) {
  const left = coordinateKey(start);
  const right = coordinateKey(end);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function pairKey(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pushRingSegments(ring, target) {
  if (!Array.isArray(ring) || ring.length < 2) {
    return;
  }

  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];

    if (!Array.isArray(start) || !Array.isArray(end)) {
      continue;
    }

    if (start[0] === end[0] && start[1] === end[1]) {
      continue;
    }

    target.push([start, end]);
  }
}

function getGeometrySegments(geometry) {
  if (!geometry) {
    return [];
  }

  const segments = [];

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => pushRingSegments(ring, segments));
    return segments;
  }

  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) =>
      polygon.forEach((ring) => pushRingSegments(ring, segments))
    );
  }

  return segments;
}

function getPolygonCount(geometry) {
  if (!geometry) {
    return 0;
  }

  if (geometry.type === "Polygon") {
    return 1;
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.length;
  }

  return 0;
}

function getRingCount(geometry) {
  if (!geometry) {
    return 0;
  }

  if (geometry.type === "Polygon") {
    return geometry.coordinates.length;
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((count, polygon) => count + polygon.length, 0);
  }

  return 0;
}

export function emptyBoundaryFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export function buildDaObjectionIndex(geojson) {
  const featureByDguid = new Map();
  const adjacencyByDguid = new Map();
  const boundarySegmentsByPair = new Map();
  const edgeOwners = new Map();

  const features = Array.isArray(geojson?.features) ? geojson.features : [];

  features.forEach((feature) => {
    const dguid = String(feature?.properties?.DGUID ?? feature?.id ?? "");

    if (!dguid) {
      return;
    }

    featureByDguid.set(dguid, feature);
    adjacencyByDguid.set(dguid, new Set());

    const seenEdges = new Set();
    const segments = getGeometrySegments(feature.geometry);

    segments.forEach((segment) => {
      const key = edgeKey(segment[0], segment[1]);

      if (seenEdges.has(key)) {
        return;
      }

      seenEdges.add(key);

      if (!edgeOwners.has(key)) {
        edgeOwners.set(key, {
          segment,
          dguidSet: new Set(),
        });
      }

      edgeOwners.get(key).dguidSet.add(dguid);
    });
  });

  edgeOwners.forEach(({ dguidSet, segment }) => {
    const owners = Array.from(dguidSet);

    if (owners.length < 2) {
      return;
    }

    for (let leftIndex = 0; leftIndex < owners.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < owners.length; rightIndex += 1) {
        const left = owners[leftIndex];
        const right = owners[rightIndex];
        const key = pairKey(left, right);

        adjacencyByDguid.get(left)?.add(right);
        adjacencyByDguid.get(right)?.add(left);

        if (!boundarySegmentsByPair.has(key)) {
          boundarySegmentsByPair.set(key, []);
        }

        boundarySegmentsByPair.get(key).push(segment);
      }
    }
  });

  return {
    featureByDguid,
    adjacencyByDguid,
    boundarySegmentsByPair,
  };
}

export function areDaNeighbours(index, leftDguid, rightDguid) {
  if (!index || !leftDguid || !rightDguid) {
    return false;
  }

  return index.adjacencyByDguid.get(String(leftDguid))?.has(String(rightDguid)) ?? false;
}

export function getSharedBoundaryFeatureCollection(index, leftDguid, rightDguid) {
  if (!index || !leftDguid || !rightDguid) {
    return emptyBoundaryFeatureCollection();
  }

  const segments = index.boundarySegmentsByPair.get(
    pairKey(String(leftDguid), String(rightDguid))
  );

  if (!segments?.length) {
    return emptyBoundaryFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: segments.map((segment, indexValue) => ({
      type: "Feature",
      properties: {
        id: `${pairKey(leftDguid, rightDguid)}:${indexValue}`,
      },
      geometry: {
        type: "LineString",
        coordinates: segment,
      },
    })),
  };
}

export function getDaGeometrySummary(index, dguid) {
  const feature = index?.featureByDguid.get(String(dguid));

  if (!feature?.geometry) {
    return null;
  }

  return {
    geometryType: feature.geometry.type,
    polygonCount: getPolygonCount(feature.geometry),
    ringCount: getRingCount(feature.geometry),
  };
}
