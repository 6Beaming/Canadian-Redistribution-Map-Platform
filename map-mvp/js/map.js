const DA_GEOJSON_URL = "data/single_fed_das.geojson";
const FED_GEOJSON_URL = "data/fed_boundaries_2023.geojson";
const FED_PMTILES_URL = "data/fed_boundaries_2023.pmtiles";
const FED_SOURCE_LAYER = "fed2023_districts";
const MVP_FED_NUM = "60001";
const FED_COUNT = 343;
const SELECTED_COLOR = "#f4d03f";
const HOVER_COLOR = "#e8a0a0";

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
let selectedFedNum = null;
let hoveredDaId = null;
let hoveredFedNum = null;
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
    "fill-color": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      SELECTED_COLOR,
      ["boolean", ["feature-state", "hover"], false],
      HOVER_COLOR,
      "#ffffff",
    ],
    "fill-outline-color": [
      "case",
      fedNumMatch(),
      "#0d2137",
      "#2a2a2a",
    ],
    "fill-opacity": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      0.85,
      ["boolean", ["feature-state", "hover"], false],
      0.75,
      1,
    ],
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
    promoteId: { [FED_SOURCE_LAYER]: "fed_num" },
  });
}

function addFedGeojsonSource(map, fedGeojson) {
  map.addSource("fed-2023", {
    type: "geojson",
    data: fedGeojson,
    promoteId: "fed_num",
  });
}

function fedFeatureTarget(fedId) {
  const target = { source: "fed-2023", id: fedId };
  if (fedSourceMode === "pmtiles") {
    target.sourceLayer = FED_SOURCE_LAYER;
  }
  return target;
}

function setFedFeatureState(map, fedId, state) {
  map.setFeatureState(fedFeatureTarget(fedId), state);
}

function clearFedFeatureState(map, fedId) {
  map.removeFeatureState(fedFeatureTarget(fedId));
}

function getFeatureId(feature, ...propertyKeys) {
  if (feature.id !== undefined && feature.id !== null) return feature.id;
  const props = feature.properties ?? {};
  for (const key of propertyKeys) {
    const value = props[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
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

function effectiveAreaStatusLabel(daCount) {
  return `Effective Area: Yukon FED (${MVP_FED_NUM}) - ${daCount} DAs`;
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
        ["boolean", ["feature-state", "hover"], false],
        HOVER_COLOR,
        "#4e79a7",
      ],
      "fill-opacity": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.85,
        ["boolean", ["feature-state", "hover"], false],
        0.72,
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

function pickInteractiveFeature(map, point) {
  const daFeatures = map.queryRenderedFeatures(point, { layers: ["da-fill"] });
  if (daFeatures.length) {
    const feature = daFeatures[0];
    const id = getFeatureId(feature, "DGUID");
    if (id) return { type: "da", feature, id };
  }

  const fedFeatures = map.queryRenderedFeatures(point, { layers: ["fed-fill"] });
  if (fedFeatures.length) {
    const feature = fedFeatures[0];
    if (isMvpFed(feature.properties)) return null;
    const id = getFeatureId(feature, "fed_num");
    if (id) return { type: "fed", feature, id };
  }

  return null;
}

function isMvpFed(properties) {
  return String(properties?.fed_num ?? "") === MVP_FED_NUM;
}

function clearDaSelection(map) {
  if (selectedDguid === null || selectedDguid === undefined) return;
  map.setFeatureState({ source: "das", id: selectedDguid }, { selected: false });
  selectedDguid = null;
}

function clearFedSelection(map) {
  if (selectedFedNum === null || selectedFedNum === undefined) return;
  setFedFeatureState(map, selectedFedNum, { selected: false });
  selectedFedNum = null;
}

function clearAllSelection(map) {
  clearDaSelection(map);
  clearFedSelection(map);
}

function applySelection(map, hit) {
  clearAllSelection(map);

  if (hit.type === "da") {
    selectedDguid = hit.id;
    map.setFeatureState({ source: "das", id: hit.id }, { selected: true });
    return;
  }

  selectedFedNum = hit.id;
  setFedFeatureState(map, hit.id, { selected: true });
}

function clearHover(map) {
  if (hoveredDaId !== null && hoveredDaId !== undefined) {
    map.setFeatureState({ source: "das", id: hoveredDaId }, { hover: false });
    hoveredDaId = null;
  }
  if (hoveredFedNum !== null && hoveredFedNum !== undefined) {
    setFedFeatureState(map, hoveredFedNum, { hover: false });
    hoveredFedNum = null;
  }
}

function updateHover(map, hit) {
  const nextDaId = hit?.type === "da" ? hit.id : null;
  const nextFedId = hit?.type === "fed" ? hit.id : null;

  if (hoveredDaId === nextDaId && hoveredFedNum === nextFedId) return;

  if (hoveredDaId !== null && hoveredDaId !== undefined && hoveredDaId !== nextDaId) {
    map.setFeatureState({ source: "das", id: hoveredDaId }, { hover: false });
  }
  if (
    hoveredFedNum !== null &&
    hoveredFedNum !== undefined &&
    hoveredFedNum !== nextFedId
  ) {
    setFedFeatureState(map, hoveredFedNum, { hover: false });
  }

  hoveredDaId = nextDaId;
  hoveredFedNum = nextFedId;

  if (nextDaId !== null && nextDaId !== undefined) {
    map.setFeatureState({ source: "das", id: nextDaId }, { hover: true });
  }
  if (nextFedId !== null && nextFedId !== undefined) {
    setFedFeatureState(map, nextFedId, { hover: true });
  }
}

function handleDaClick(map, hit) {
  clearHover(map);
  applySelection(map, hit);
  showDaPanel(hit.id);
}

function handleFedClick(map, hit) {
  clearHover(map);
  applySelection(map, hit);
  showFedPanel(hit.id, getFedDisplayName(hit.id));
}

function setupMapInteractions(map) {
  map.on("click", (event) => {
    const hit = pickInteractiveFeature(map, event.point);
    if (!hit) return;

    if (hit.type === "da") {
      handleDaClick(map, hit);
    } else {
      handleFedClick(map, hit);
    }
  });

  map.on("mousemove", (event) => {
    const hit = pickInteractiveFeature(map, event.point);
    if (!hit) {
      clearHover(map);
      map.getCanvas().style.cursor = "";
      return;
    }

    map.getCanvas().style.cursor = "pointer";
    updateHover(map, hit);
  });

  map.on("mouseout", () => {
    clearHover(map);
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
      const labelCounts = await addLabelLayers(map, daGeojson);
      setupOutlineZoomGuard(map);
      setupMapInteractions(map);
      showEmptyPanel();

      const daBounds = extendBoundsFromGeoJSON(
        new maplibregl.LngLatBounds(),
        daGeojson
      );

      map.fitBounds(daBounds, { padding: 48, duration: 0 });
      map.setMaxBounds(paddedMaxBounds(CANADA_BOUNDS, 0.08));

      const baseLabel = fedMode === "pmtiles" ? "PMTiles" : "GeoJSON";
      setStatus(effectiveAreaStatusLabel(daCount));
      console.log(
        `[OK] FED base: ${fedMode} (${baseLabel});`,
        daCount,
        "DA polygons on",
        FED_COUNT,
        "FED base;",
        labelCounts.fedCount,
        "FED labels;",
        labelCounts.profileCount,
        "DA profiles;",
        labelCounts.daLabelCount,
        "DA map labels"
      );
    } catch (error) {
      console.error("[ERROR]", error);
      setStatus(`Error: ${error.message}`);
    }
  });

  return map;
}

initMap();
