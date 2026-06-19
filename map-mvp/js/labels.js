const FED_LABELS_URL = "data/fed_labels.geojson";
const PLACE_LABELS_YT_URL = "data/place_labels_yt.geojson";

const LABEL_ZOOM = {
  FED_MIN: 3,
  FED_MAX: 8,
  PLACE_MIN: 8,
};

const LABEL_FONT = ["Open Sans Regular", "Arial Unicode MS Regular"];

async function loadLabelGeoJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return response.json();
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

function placeLabelLayout() {
  return {
    "text-field": ["get", "name"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 11, 13, 14, 14],
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

function addPlaceLabelLayer(map, geojson) {
  map.addSource("place-labels-yt", {
    type: "geojson",
    data: geojson,
  });

  map.addLayer({
    id: "place-labels-yt",
    type: "symbol",
    source: "place-labels-yt",
    minzoom: LABEL_ZOOM.PLACE_MIN,
    layout: placeLabelLayout(),
    paint: labelPaint("#1a5276"),
  });
}

/**
 * Insert label layers above FED/DA polygons but below UI hit targets.
 * Call after addFedBaseLayers and addDaLayers.
 */
async function addLabelLayers(map) {
  const [fedLabels, placeLabels] = await Promise.all([
    loadLabelGeoJSON(FED_LABELS_URL),
    loadLabelGeoJSON(PLACE_LABELS_YT_URL),
  ]);

  addFedLabelLayer(map, fedLabels);
  addPlaceLabelLayer(map, placeLabels);

  return {
    fedCount: fedLabels.features?.length ?? 0,
    placeCount: placeLabels.features?.length ?? 0,
  };
}
