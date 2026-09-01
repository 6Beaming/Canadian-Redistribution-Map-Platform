function normalizeNumber(value) {
  return Number(value).toFixed(6);
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

function buildOccurrenceIndex(features, targetCoordinateKeys) {
  const occurrenceByCoordinate = new Map();

  features.forEach((feature) => {
    const dguid = featureDguid(feature);
    visitGeometryCoordinates(feature.geometry, (entry) => {
      const key = coordinateKey(entry.coordinate);
      if (!targetCoordinateKeys.has(key)) {
        return;
      }

      if (!occurrenceByCoordinate.has(key)) {
        occurrenceByCoordinate.set(key, []);
      }

      occurrenceByCoordinate.get(key).push({
        featureDguid: dguid,
        polygonIndex: entry.polygonIndex,
        ringIndex: entry.ringIndex,
        coordinateIndex: entry.coordinateIndex,
      });
    });
  });

  return occurrenceByCoordinate;
}

export function buildReleaseEditableHandles(editableHandles, features) {
  const releaseHandles = Array.isArray(editableHandles) ? editableHandles : [];
  const targetCoordinateKeys = new Set(
    releaseHandles
      .map((handle) => handle?.coordinate)
      .filter((coordinate) => Array.isArray(coordinate))
      .map((coordinate) => coordinateKey(coordinate)),
  );
  const occurrenceByCoordinate = buildOccurrenceIndex(features, targetCoordinateKeys);

  return releaseHandles
    .map((vertex, index) => {
      const coordinate = [...vertex.coordinate];
      const key = coordinateKey(coordinate);
      const occurrences = occurrenceByCoordinate.get(key) ?? [];

      return {
        id: `release:${vertex.vertexId ?? `vertex-${index}`}`,
        legacyId: key,
        vertexId: vertex.vertexId ?? null,
        lineId: `arc-${vertex.arcId ?? index}`,
        segmentIndex: index,
        coordinate,
        locked: Boolean(vertex.locked),
        required: Boolean(vertex.required ?? vertex.locked),
        featureDguids: [...new Set(occurrences.map((entry) => entry.featureDguid))],
        occurrences,
      };
    })
    .filter((handle) => handle.locked || handle.occurrences.length > 0);
}
