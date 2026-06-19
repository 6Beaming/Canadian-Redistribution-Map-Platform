const FED_LABELS_URL = "data/fed_labels.geojson";

const DA_PROFILES_URL = "data/yt_da_profiles.json";



const MISSING_DA_NAME = "missing name";

const MISSING_DA_POPULATION = "missing population";



const LABEL_ZOOM = {

  FED_MIN: 3,

  FED_MAX: 8,

  DA_MIN: 8,

};



const LABEL_FONT = ["Open Sans Regular", "Arial Unicode MS Regular"];



/** fed_num → display name (from fed_labels.geojson) */

const fedNameByNum = {};



/** DGUID → profile row from yt_da_profiles.json */

const daProfileByDguid = {};



let daProfilesMeta = null;



async function loadLabelGeoJSON(url) {

  const response = await fetch(url);

  if (!response.ok) {

    throw new Error(`Failed to load ${url} (${response.status})`);

  }

  return response.json();

}



async function loadDaProfiles() {

  const response = await fetch(DA_PROFILES_URL);

  if (!response.ok) {

    throw new Error(`Failed to load ${DA_PROFILES_URL} (${response.status})`);

  }

  const payload = await response.json();

  Object.keys(daProfileByDguid).forEach((key) => delete daProfileByDguid[key]);



  const profiles = payload.profiles ?? {};

  Object.entries(profiles).forEach(([dguid, profile]) => {

    daProfileByDguid[dguid] = profile;

  });

  daProfilesMeta = payload._meta ?? null;

  return Object.keys(profiles).length;

}



function getDaProfile(dguid) {

  if (!dguid) return null;

  return daProfileByDguid[dguid] ?? null;

}



function isMissingDaName(name) {

  const text = String(name ?? "").trim();

  return !text || text === MISSING_DA_NAME;

}



function isDaUnorganized(profile) {
  if (!profile) return false;
  if (profile.is_unorganized === true) return true;
  const csd = String(profile.community_name ?? "").trim();
  if (!csd) return false;
  if (csd === "Unorganized" || csd === "Yukon, Unorganized" || csd === "Whitehorse, Unorganized") {
    return true;
  }
  return csd.startsWith("Yukon, ") && csd.slice(7).trim() === "Unorganized";
}

function getDaPanelTitle(profile) {
  const daCode = profile?.da_code ?? profile?.geo_name;
  const codeText = daCode != null && String(daCode).trim() ? String(daCode).trim() : "—";
  const unorganized = isDaUnorganized(profile);
  const name = profile?.panel_title || profile?.community_display;

  if (name && !unorganized && !isMissingDaName(name)) {
    return { text: name, unorganized: false };
  }

  return { text: `Unnamed DA: DA ${codeText}`, unorganized };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDaPanelTitleHtml(profile) {
  const { text, unorganized } = getDaPanelTitle(profile);
  const mark = unorganized
    ? '<sup class="panel-title-mark" aria-hidden="true">*</sup>'
    : "";
  return `${escapeHtml(text)}${mark}`;
}

function getDaDisplayLabel(dguid) {
  const profile = getDaProfile(dguid);
  if (!profile) return MISSING_DA_NAME;
  if (profile.display_label) return profile.display_label;
  const title = getDaPanelTitle(profile);
  return title.text;
}



function getDaMapLabel(dguid) {

  const profile = getDaProfile(dguid);

  if (!profile) return null;

  const mapLabel = profile.map_label;

  if (mapLabel && String(mapLabel).trim()) return String(mapLabel).trim();

  return getDaDisplayLabel(dguid);

}



function getDaPopulationDisplay(dguid) {

  const profile = getDaProfile(dguid);

  const pop = profile?.population;

  if (pop === null || pop === undefined || Number.isNaN(Number(pop))) {

    return MISSING_DA_POPULATION;

  }

  return Number(pop);

}



function hasPendingDaData() {

  if (!daProfilesMeta) return true;

  return (daProfilesMeta.missing ?? 0) > 0 || (daProfilesMeta.partial ?? 0) > 0;

}



function ringCentroid(ring) {

  if (ring.length < 3) {

    const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;

    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;

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

    const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;

    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;

    return [lng, lat];

  }

  return [cx / (6 * area), cy / (6 * area)];

}



function featureCentroid(feature) {

  const { type, coordinates } = feature.geometry;

  if (type === "Point") return coordinates;

  const ring = type === "Polygon" ? coordinates[0] : coordinates[0][0];

  return ringCentroid(ring);

}



function buildFedNameLookup(fedLabels) {

  Object.keys(fedNameByNum).forEach((key) => delete fedNameByNum[key]);

  fedLabels.features.forEach((feature) => {

    const props = feature.properties ?? {};

    const fedNum = String(props.fed_num ?? props.geo_code ?? "").trim();

    const name = String(props.name ?? "").trim();

    if (fedNum && name) fedNameByNum[fedNum] = name;

  });

}



function buildDaLabelGeoJSON(daGeojson) {

  const features = [];

  daGeojson.features.forEach((feature) => {

    const dguid = feature.properties?.DGUID;

    if (!dguid) return;

    const label = getDaMapLabel(dguid);

    if (!label || isMissingDaName(label)) return;

    const [lng, lat] = featureCentroid(feature);

    features.push({

      type: "Feature",

      geometry: { type: "Point", coordinates: [lng, lat] },

      properties: { name: label, dguid },

    });

  });

  return { type: "FeatureCollection", features };

}



function getFedDisplayName(fedNum) {

  const key = String(fedNum ?? "").trim();

  return fedNameByNum[key] || `FED ${key}`;

}



function fedLabelLayout() {

  return {

    "text-field": ["get", "name"],

    "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 6, 11, 8, 13],

    "text-anchor": "center",

    "text-allow-overlap": false,

    "text-ignore-placement": false,

    "text-padding": 2,

    "text-max-width": 10,

    "text-font": LABEL_FONT,

  };

}



function daLabelLayout() {

  return {

    "text-field": ["get", "name"],

    "text-size": ["interpolate", ["linear"], ["zoom"], 8, 9, 11, 12, 14, 13],

    "text-anchor": "center",

    "text-allow-overlap": false,

    "text-ignore-placement": false,

    "text-padding": 4,

    "text-max-width": 8,

    "text-font": LABEL_FONT,

  };

}



function labelPaint(color = "#333333") {

  return {

    "text-color": color,

    "text-halo-color": "#ffffff",

    "text-halo-width": 1.5,

  };

}



function addFedLabelLayer(map, geojson) {

  map.addSource("fed-labels", {

    type: "geojson",

    data: geojson,

  });



  map.addLayer({

    id: "fed-labels",

    type: "symbol",

    source: "fed-labels",

    minzoom: LABEL_ZOOM.FED_MIN,

    maxzoom: LABEL_ZOOM.FED_MAX,

    layout: fedLabelLayout(),

    paint: labelPaint("#2c3e50"),

  });

}



function addDaLabelLayer(map, geojson) {

  if (!geojson.features.length) return 0;



  map.addSource("da-labels-yt", {

    type: "geojson",

    data: geojson,

  });



  map.addLayer({

    id: "da-labels-yt",

    type: "symbol",

    source: "da-labels-yt",

    minzoom: LABEL_ZOOM.DA_MIN,

    layout: daLabelLayout(),

    paint: labelPaint("#1a5276"),

  });

  return geojson.features.length;

}



/**

 * Load FED labels + external DA profiles; add label layers.

 * DA panel titles come from yt_da_profiles.json (not boundary GeoJSON).

 */

async function addLabelLayers(map, daGeojson) {

  const [fedLabels, profileCount] = await Promise.all([

    loadLabelGeoJSON(FED_LABELS_URL),

    loadDaProfiles(),

  ]);



  buildFedNameLookup(fedLabels);

  addFedLabelLayer(map, fedLabels);



  const daLabels = buildDaLabelGeoJSON(daGeojson);

  const daLabelCount = addDaLabelLayer(map, daLabels);



  return {

    fedCount: fedLabels.features?.length ?? 0,

    daLabelCount,

    profileCount,

  };

}


