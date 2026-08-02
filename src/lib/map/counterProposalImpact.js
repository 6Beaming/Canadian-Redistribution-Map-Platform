const EARTH_RADIUS_METERS = 6378137;

function projectLngLatToMeters(coordinate) {
  const lng = Number(coordinate[0]) * (Math.PI / 180);
  const lat = Math.max(Math.min(Number(coordinate[1]), 89.9), -89.9) * (Math.PI / 180);
  return [
    EARTH_RADIUS_METERS * lng,
    EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + lat / 2)),
  ];
}

function ringAreaMeters(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x0, y0] = projectLngLatToMeters(ring[index]);
    const [x1, y1] = projectLngLatToMeters(ring[index + 1]);
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

export function geometryAreaMeters(geometry) {
  if (geometry?.type === "Polygon") {
    const [outer = [], ...holes] = geometry.coordinates ?? [];
    return Math.max(0, ringAreaMeters(outer) - holes.reduce((sum, ring) => sum + ringAreaMeters(ring), 0));
  }
  if (geometry?.type === "MultiPolygon") {
    return (geometry.coordinates ?? []).reduce((total, polygon) => {
      const [outer = [], ...holes] = polygon;
      return total + Math.max(0, ringAreaMeters(outer) - holes.reduce((sum, ring) => sum + ringAreaMeters(ring), 0));
    }, 0);
  }
  return 0;
}

function featureArray(value) {
  return Array.isArray(value) ? value : value?.features ?? [];
}

function dguidOf(feature) {
  return String(feature?.properties?.DGUID ?? feature?.id ?? "");
}

function populationValue(populationByDguid, dguid) {
  const raw = populationByDguid instanceof Map
    ? populationByDguid.get(dguid)
    : populationByDguid?.[dguid];
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw?.population ?? raw);
  return Number.isFinite(value) ? value : null;
}

export function calculateCounterProposalImpact({
  originalFeatures,
  proposedFeatures,
  firstDguid,
  secondDguid,
  populationByDguid = {},
}) {
  const original = featureArray(originalFeatures);
  const proposed = featureArray(proposedFeatures);
  const ids = [String(firstDguid ?? ""), String(secondDguid ?? "")];
  if (ids.some((id) => !id) || original.length < 2 || proposed.length < 2) {
    return {
      version: 1,
      method: "area-proportional-v1",
      availability: "unavailable",
      reason: "Both original and proposed DA geometries are required.",
      byDguid: {},
      transfer: { fromDguid: null, toDguid: null, amount: null },
    };
  }

  const originalArea = Object.fromEntries(original.map((feature) => [dguidOf(feature), geometryAreaMeters(feature.geometry)]));
  const currentArea = Object.fromEntries(proposed.map((feature) => [dguidOf(feature), geometryAreaMeters(feature.geometry)]));
  if (ids.some((id) => !Number.isFinite(originalArea[id])
    || !Number.isFinite(currentArea[id])
    || originalArea[id] <= 0
    || currentArea[id] <= 0)) {
    return {
      version: 1,
      method: "area-proportional-v1",
      availability: "unavailable",
      reason: "The DA geometry could not be measured.",
      byDguid: {},
      transfer: { fromDguid: null, toDguid: null, amount: null },
    };
  }

  const areaDelta = Object.fromEntries(ids.map((id) => [id, currentArea[id] - originalArea[id]]));
  const populations = Object.fromEntries(ids.map((id) => [id, populationValue(populationByDguid, id)]));
  const losingDguid = areaDelta[ids[0]] < 0 ? ids[0] : areaDelta[ids[1]] < 0 ? ids[1] : null;
  const gainingDguid = losingDguid ? ids.find((id) => id !== losingDguid) : null;
  const losingPopulation = losingDguid ? populations[losingDguid] : null;
  const transferAmount = losingDguid && losingPopulation !== null && originalArea[losingDguid] > 0
    ? (Math.abs(areaDelta[losingDguid]) / originalArea[losingDguid]) * losingPopulation
    : losingDguid ? null : 0;

  return {
    version: 1,
    method: "area-proportional-v1",
    availability: "available",
    byDguid: Object.fromEntries(ids.map((id) => [id, {
      originalArea: originalArea[id],
      currentArea: currentArea[id],
      areaDelta: areaDelta[id],
      population: populations[id],
      populationDelta: populations[id] === null || transferAmount === null
        ? null
        : losingDguid === id ? -transferAmount : gainingDguid === id ? transferAmount : 0,
      populationAvailable: populations[id] !== null,
    }])),
    transfer: {
      fromDguid: losingDguid,
      toDguid: gainingDguid,
      amount: transferAmount,
    },
  };
}
