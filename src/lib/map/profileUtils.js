import {
  MISSING_DA_NAME,
  MISSING_DA_POPULATION
} from "./constants.js";

export function isMissingDaName(name) {
  const text = String(name ?? "").trim();
  return !text || text === MISSING_DA_NAME;
}

export function isDaUnorganized(profile) {
  if (!profile) return false;
  if (profile.is_unorganized === true) return true;
  const csd = String(profile.community_name ?? "").trim();
  if (!csd) return false;
  if (csd === "Unorganized" || csd === "Yukon, Unorganized" || csd === "Whitehorse, Unorganized") {
    return true;
  }
  return csd.startsWith("Yukon, ") && csd.slice(7).trim() === "Unorganized";
}

export function getDaPanelTitle(profile) {
  const daCode = profile?.da_code ?? profile?.geo_name;
  const codeText = daCode != null && String(daCode).trim() ? String(daCode).trim() : "—";
  const unorganized = isDaUnorganized(profile);
  const name = profile?.panel_title || profile?.community_display;

  if (name && !unorganized && !isMissingDaName(name)) {
    return { text: name, unorganized: false };
  }

  return { text: `Unnamed DA: DA ${codeText}`, unorganized: true };
}

export function getDaDisplayLabel(profile) {
  if (!profile) return MISSING_DA_NAME;
  if (profile.display_label) return profile.display_label;
  return getDaPanelTitle(profile).text;
}

export function getDaMapLabel(profile) {
  if (!profile) return null;
  const mapLabel = profile.map_label;
  if (mapLabel && String(mapLabel).trim()) return String(mapLabel).trim();
  return getDaDisplayLabel(profile);
}

export function getDaPopulationDisplay(profile) {
  const pop = profile?.population;
  if (pop === null || pop === undefined || Number.isNaN(Number(pop))) {
    return MISSING_DA_POPULATION;
  }
  return Number(pop);
}

export function buildProfileIndex(payload) {
  const profiles = payload?.profiles ?? {};
  const index = new Map();

  Object.entries(profiles).forEach(([dguid, profile]) => {
    index.set(dguid, profile);
  });

  return {
    index,
    meta: payload?._meta ?? null
  };
}

export function buildFedNameLookup(fedLabels) {
  const lookup = new Map();
  fedLabels.features?.forEach((feature) => {
    const props = feature.properties ?? {};
    const fedNum = String(props.fed_num ?? props.geo_code ?? "").trim();
    const name = String(props.name ?? "").trim();
    if (fedNum && name) lookup.set(fedNum, name);
  });
  return lookup;
}

export function ringCentroid(ring) {
  if (ring.length < 3) {
    const lng = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
    const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    return [lng, lat];
  }

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < ring.length; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    const lng = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
    const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    return [lng, lat];
  }

  return [cx / (6 * area), cy / (6 * area)];
}

export function featureCentroid(feature) {
  const { type, coordinates } = feature.geometry;
  if (type === "Point") return coordinates;
  const ring = type === "Polygon" ? coordinates[0] : coordinates[0][0];
  return ringCentroid(ring);
}

function classifyMapLabel(label, profile) {
  const text = String(label ?? "").trim();
  const daCode = String(profile?.da_code ?? "").trim();
  if (!text) return { kind: "code", priority: 0 };
  if (/^\d{7,}$/.test(text) || (daCode && text === daCode)) {
    return { kind: "code", priority: 0 };
  }
  return { kind: "community", priority: 2 };
}

export function buildDaLabelGeoJSON(daGeojson, profileIndex) {
  const features = [];

  daGeojson.features.forEach((feature) => {
    const dguid = feature.properties?.DGUID;
    if (!dguid) return;

    const profile = profileIndex.get(dguid);
    const label = getDaMapLabel(profile);
    if (!label || isMissingDaName(label)) return;

    const { kind, priority } = classifyMapLabel(label, profile);
    const [lng, lat] = featureCentroid(feature);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { name: label, dguid, kind, priority }
    });
  });

  return { type: "FeatureCollection", features };
}
