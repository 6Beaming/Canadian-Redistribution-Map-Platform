const DA_GEOJSON_URL = "data/single_fed_das.geojson";
const FED_GEOJSON_URL = "data/fed_boundaries_2023.geojson";
const FED_PMTILES_URL = "data/fed_boundaries_2023.pmtiles";
const FED_SOURCE_LAYER = "fed2023_districts";
const MVP_FED_NUM = "60001";
const FED_COUNT = 343;
const SELECTED_COLOR = "#f4d03f";

// DA outlines still use GeoJSON — keep hidden at low zoom to avoid chord artifacts.
const OUTLINE_ZOOM = {
  DA_MIN: 9,
};

const CANADA_BOUNDS = new maplibregl.LngLatBounds(
  [-141.5, 41.0],
  [-52.0, 83.9]
);

const WHITE_BASEMAP_STYLE = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#ffffff" },
    },
  ],
};

const statusEl = document.getElementById("status");
let selectedDguid = null;
let fedSourceMode = "pmtiles";

function registerPmtilesProtocol() {
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
}

function pmtilesSourceUrl(relativePath) {
  const absolute = new URL(relativePath, window.location.href).href;
  return `pmtiles://${absolute}`;
}

function setStatus(message) {
  statusEl.textContent = message;
}

async function fetchGeoJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return response.json();
}

function forEachCoordinate(coords, geometryType, callback) {
  if (geometryType === "Polygon") {
    coords.forEach((ring) => ring.forEach(callback));
    return;
  }
  if (geometryType === "MultiPolygon") {
    coords.forEach((polygon) =>
      polygon.forEach((ring) => ring.forEach(callback))
    );
  }
}

function extendBoundsFromGeoJSON(bounds, geojson) {
  geojson.features.forEach((feature) => {
    const { type, coordinates } = feature.geometry;
    forEachCoordinate(coordinates, type, ([lng, lat]) => {
      bounds.extend([lng, lat]);
    });
  });
  return bounds;
}

function paddedMaxBounds(bounds, factor = 0.35) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const padLng = (ne.lng - sw.lng) * factor;
  const padLat = (ne.lat - sw.lat) * factor;
  return new maplibregl.LngLatBounds(
    [sw.lng - padLng, sw.lat - padLat],
    [ne.lng + padLng, ne.lat + padLat]
  );
}

function fedNumMatch() {
  return ["==", ["to-string", ["get", "fed_num"]], MVP_FED_NUM];
}

function fedFillPaint() {
  return {
    "fill-color": "#ffffff",
    "fill-outline-color": [
      "case",
      fedNumMatch(),
      "#0d2137",
      "#2a2a2a",
    ],
    "fill-opacity": 1,
    "fill-antialias": true,
  };
}

function fedOutlinePaint() {
  return {
    "line-color": [
      "case",
      fedNumMatch(),
      "#0d2137",
      "#2a2a2a",
    ],
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      ["case", fedNumMatch(), 2.4, 1.6],
      6,
      ["case", fedNumMatch(), 3, 2],
      10,
      ["case", fedNumMatch(), 3.5, 2.4],
    ],
    "line-opacity": 1,
  };
}

function addFedFillLayer(map, useVectorTiles) {
  const layer = {
    id: "fed-fill",
    type: "fill",
    source: "fed-2023",
    paint: fedFillPaint(),
  };
  if (useVectorTiles) {
    layer["source-layer"] = FED_SOURCE_LAYER;
  }
  map.addLayer(layer);
}

function addFedOutlineLayer(map, useVectorTiles) {
  if (!useVectorTiles) return;

  const layer = {
    id: "fed-outline",
    type: "line",
    source: "fed-2023",
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: fedOutlinePaint(),
    "source-layer": FED_SOURCE_LAYER,
  };
  map.addLayer(layer);
}

function addFedPmtilesSource(map) {
  map.addSource("fed-2023", {
    type: "vector",
    url: pmtilesSourceUrl(FED_PMTILES_URL),
  });
}

function addFedGeojsonSource(map, fedGeojson) {
  map.addSource("fed-2023", {
    type: "geojson",
    data: fedGeojson,
  });
}

async function serverSupportsByteServing(url) {
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-1" } });
    if (response.status !== 206) return false;

    const contentRange = response.headers.get("Content-Range");
    const contentLength = Number(response.headers.get("Content-Length") ?? "0");
    // Reject servers that ignore Range and return the full file (Content-Length >> 2).
    if (!contentRange || !contentRange.startsWith("bytes ")) return false;
    if (contentLength > 2) return false;

    return true;
  } catch {
    return false;
  }
}

async function addFedBaseLayers(map) {
  const usePmtiles = await serverSupportsByteServing(FED_PMTILES_URL);
  fedSourceMode = usePmtiles ? "pmtiles" : "geojson";

  if (usePmtiles) {
    addFedPmtilesSource(map);
    addFedFillLayer(map, true);
    addFedOutlineLayer(map, true);
    return "pmtiles";
  }

  console.info(
    "[INFO] HTTP byte serving unavailable — using GeoJSON FED base. " +
      "Run: npm run dev:map"
  );

  const fedGeojson = await fetchGeoJSON(FED_GEOJSON_URL);
  addFedGeojsonSource(map, fedGeojson);
  addFedFillLayer(map, false);
  return "geojson";
}

function fedBaseStatusLabel(mode, daCount) {
  const baseLabel = mode === "pmtiles" ? "PMTiles" : "GeoJSON";
  return `Yukon FED ${MVP_FED_NUM}: ${daCount} DAs on ${FED_COUNT} FED base (${baseLabel})`;
}

function addDaLayers(map, daGeojson) {
  map.addSource("das", {
    type: "geojson",
    data: daGeojson,
    promoteId: "DGUID",
  });

  map.addLayer({
    id: "da-fill",
    type: "fill",
    source: "das",
    paint: {
      "fill-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        SELECTED_COLOR,
        "#4e79a7",
      ],
      "fill-opacity": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.85,
        0.55,
      ],
      "fill-antialias": true,
    },
  });

  map.addLayer({
    id: "da-outline",
    type: "line",
    source: "das",
    layout: {
      visibility: "none",
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        "#b7950b",
        "#3d5a73",
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        OUTLINE_ZOOM.DA_MIN,
        0,
        OUTLINE_ZOOM.DA_MIN + 2,
        [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1.4,
          0.6,
        ],
      ],
      "line-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        OUTLINE_ZOOM.DA_MIN,
        0,
        OUTLINE_ZOOM.DA_MIN + 1,
        0.9,
      ],
    },
  });
}

/** DA GeoJSON lines still need zoom guard; PMTiles FED layer does not. */
function syncDaOutlineVisibility(map) {
  if (!map.getLayer("da-outline")) return;
  const visible = map.getZoom() >= OUTLINE_ZOOM.DA_MIN ? "visible" : "none";
  map.setLayoutProperty("da-outline", "visibility", visible);
}

function setupOutlineZoomGuard(map) {
  syncDaOutlineVisibility(map);
  map.on("zoom", () => syncDaOutlineVisibility(map));
}

function getClickedDa(map, event) {
  const features = map.queryRenderedFeatures(event.point, { layers: ["da-fill"] });
  if (!features.length) return null;
  return features[0];
}

function handleDaClick(map, event) {
  const feature = getClickedDa(map, event);
  if (!feature) return;

  const dguid = feature.properties?.DGUID ?? feature.id;
  if (!dguid) return;

  if (selectedDguid && selectedDguid !== dguid) {
    map.removeFeatureState({ source: "das", id: selectedDguid });
  }

  selectDa(map, dguid);
  selectedDguid = dguid;
  showDaPanel(feature.properties);
}

function getClickedFed(map, event) {
  const features = map.queryRenderedFeatures(event.point, { layers: ["fed-fill"] });
  if (!features.length) return null;
  return features[0];
}

function isMvpFed(properties) {
  return String(properties?.fed_num ?? "") === MVP_FED_NUM;
}

function handleFedClick(map, event) {
  if (getClickedDa(map, event)) return;

  const feature = getClickedFed(map, event);
  if (!feature || isMvpFed(feature.properties)) return;

  showComingSoonPanel(feature.properties);
}

function setupDaInteractions(map) {
  map.on("click", "da-fill", (event) => handleDaClick(map, event));

  map.on("mouseenter", "da-fill", () => {
    map.getCanvas().style.cursor = "pointer";
  });

  map.on("mouseleave", "da-fill", () => {
    map.getCanvas().style.cursor = "";
  });
}

function setupFedInteractions(map) {
  map.on("click", "fed-fill", (event) => handleFedClick(map, event));

  map.on("mouseenter", "fed-fill", () => {
    map.getCanvas().style.cursor = "pointer";
  });

  map.on("mouseleave", "fed-fill", () => {
    map.getCanvas().style.cursor = "";
  });
}

function initMap() {
  registerPmtilesProtocol();

  const map = new maplibregl.Map({
    container: "map",
    style: WHITE_BASEMAP_STYLE,
    center: [-135, 63.5],
    zoom: 5,
    minZoom: 1,
    maxZoom: 14,
    renderWorldCopies: false,
    maxPitch: 0,
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

  map.on("load", async () => {
    try {
      const daGeojson = await fetchGeoJSON(DA_GEOJSON_URL);
      const daCount = daGeojson.features?.length ?? 0;
      if (daCount === 0) throw new Error("DA GeoJSON contains no features");

      const fedMode = await addFedBaseLayers(map);
      addDaLayers(map, daGeojson);
      const labelCounts = await addLabelLayers(map);
      setupOutlineZoomGuard(map);
      setupFedInteractions(map);
      setupDaInteractions(map);
      showEmptyPanel();

      const daBounds = extendBoundsFromGeoJSON(
        new maplibregl.LngLatBounds(),
        daGeojson
      );

      map.fitBounds(daBounds, { padding: 48, duration: 0 });
      map.setMaxBounds(paddedMaxBounds(CANADA_BOUNDS, 0.08));

      setStatus(
        `${fedBaseStatusLabel(fedMode, daCount)} · ${labelCounts.fedCount} FED labels · ${labelCounts.placeCount} Yukon places`
      );
      console.log(
        `[OK] FED base: ${fedMode};`,
        daCount,
        "DA polygons;",
        labelCounts.fedCount,
        "FED labels;",
        labelCounts.placeCount,
        "Yukon place labels"
      );
    } catch (error) {
      console.error("[ERROR]", error);
      setStatus(`Error: ${error.message}`);
    }
  });

  return map;
}

initMap();
