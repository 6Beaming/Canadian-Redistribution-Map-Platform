import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { mapApi } from "@/services/mapApi.js";
import {
  CANADA_BOUNDS,
  FED_COUNT,
  FED_SOURCE_LAYER,
  HOVER_COLOR,
  MVP_FED_NUM,
  OUTLINE_ZOOM,
  SELECTED_COLOR,
  WHITE_BASEMAP_STYLE
} from "@/lib/map/constants.js";
import {
  buildDaLabelGeoJSON,
  buildFedNameLookup,
  buildProfileIndex
} from "@/lib/map/profileUtils.js";
import { emptyBoundaryFeatureCollection } from "@/lib/map/objectionWorkflow.js";
import { emptyCounterProposalFeatureCollection } from "@/lib/map/counterProposalWorkflow.js";
import {
  applyLabelScale,
  DA_LABEL_ZOOM,
  daCodeLabelLayout,
  daCodeLabelPaint,
  daCommunityLabelLayout,
  daCommunityLabelPaint,
  fedLocalLabelLayout,
  fedLocalLabelPaint,
  fedNationalLabelLayout,
  fedNationalLabelPaint,
  FED_LABEL_ZOOM,
  labelScreenScale
} from "@/lib/map/labelLayout.js";
import {
  getAllRolloutAreas,
  getRolloutAreas,
  getRolloutColor,
} from "@/lib/map/rolloutPlan.js";
import "maplibre-gl/dist/maplibre-gl.css";

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>`;

const EXIT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M9 20H4v-5"/><path d="M15 20h5v-5"/></svg>`;

const MAP_BOUNDARY_COLOR = "#000000";
const EMPTY_OBJECTION_BOUNDARY = emptyBoundaryFeatureCollection();
const EMPTY_COUNTER_PROPOSAL_FEATURES = emptyCounterProposalFeatureCollection();

function createFullscreenControl(buttonRef, getIsFullscreen, onToggle) {
  return {
    onAdd() {
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "maplibregl-ctrl-icon map-fullscreen-btn";
      button.innerHTML = getIsFullscreen() ? EXIT_ICON : EXPAND_ICON;
      button.setAttribute(
        "aria-label",
        getIsFullscreen() ? "Exit fullscreen map" : "Expand map to fullscreen"
      );
      button.title = getIsFullscreen() ? "Exit fullscreen" : "Fullscreen";
      button.addEventListener("click", onToggle);

      buttonRef.current = button;
      container.appendChild(button);
      return container;
    },
    onRemove() {
      buttonRef.current = null;
    }
  };
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
      ["boolean", ["feature-state", "rolloutVisible"], false],
      ["coalesce", ["feature-state", "rolloutColor"], "#ffffff"],
      "#ffffff"
    ],
    "fill-outline-color": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      MAP_BOUNDARY_COLOR,
      ["boolean", ["feature-state", "hover"], false],
      MAP_BOUNDARY_COLOR,
      ["boolean", ["feature-state", "rolloutVisible"], false],
      MAP_BOUNDARY_COLOR,
      fedNumMatch(),
      MAP_BOUNDARY_COLOR,
      MAP_BOUNDARY_COLOR
    ],
    "fill-opacity": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      0.85,
      ["boolean", ["feature-state", "hover"], false],
      0.75,
      ["boolean", ["feature-state", "rolloutVisible"], false],
      ["case", ["boolean", ["feature-state", "blinkHidden"], false], 0.24, 0.82],
      1
    ],
    "fill-antialias": true
  };
}

function fedOutlinePaint() {
  return {
    "line-color": [
      "case",
      ["boolean", ["feature-state", "rolloutVisible"], false],
      MAP_BOUNDARY_COLOR,
      fedNumMatch(),
      MAP_BOUNDARY_COLOR,
      MAP_BOUNDARY_COLOR
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
      ["case", fedNumMatch(), 3.5, 2.4]
    ],
    "line-opacity": 1
  };
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

function isMvpFed(properties) {
  return String(properties?.fed_num ?? "") === MVP_FED_NUM;
}

export function MapCanvas({
  isFullscreen = false,
  selection = null,
  externalHoverSelection = null,
  objectionPreview = null,
  counterProposalPreview = null,
  onCounterProposalDragEnd,
  onCounterProposalDragMove,
  onCounterProposalDragStart,
  onCounterProposalHandleSelect,
  onDaSelect,
  onFedSelect,
  onStatusChange,
  onToggleFullscreen,
  rolloutEnabled = false,
  rolloutCategoryId = null
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const fullscreenBtnRef = useRef(null);
  const onToggleFullscreenRef = useRef(onToggleFullscreen);
  const isFullscreenRef = useRef(isFullscreen);
  const fedNameLookupRef = useRef(new Map());
  const latestSelectionPropRef = useRef(selection);
  const selectionRef = useRef({ da: null, fed: null });
  const hoverRef = useRef({ da: null, fed: null });
  const externalHoverRef = useRef({ da: null, fed: null });
  const fedSourceModeRef = useRef("pmtiles");
  const setFedStateRef = useRef(null);
  const applySelectionRef = useRef(null);
  const applyExternalHoverRef = useRef(null);
  const applyObjectionPreviewRef = useRef(null);
  const applyCounterProposalPreviewRef = useRef(null);
  const blinkIntervalRef = useRef(null);
  const counterProposalPreviewRef = useRef(counterProposalPreview);
  const onCounterProposalHandleSelectRef = useRef(onCounterProposalHandleSelect);
  const onCounterProposalDragStartRef = useRef(onCounterProposalDragStart);
  const onCounterProposalDragMoveRef = useRef(onCounterProposalDragMove);
  const onCounterProposalDragEndRef = useRef(onCounterProposalDragEnd);
  const counterProposalDragRef = useRef(null);
  const skipNextClickRef = useRef(false);
  const isMapReadyRef = useRef(false);
  const [mapReadyTick, setMapReadyTick] = useState(0);

  onToggleFullscreenRef.current = onToggleFullscreen;
  isFullscreenRef.current = isFullscreen;
  latestSelectionPropRef.current = selection;
  counterProposalPreviewRef.current = counterProposalPreview;
  onCounterProposalHandleSelectRef.current = onCounterProposalHandleSelect;
  onCounterProposalDragStartRef.current = onCounterProposalDragStart;
  onCounterProposalDragMoveRef.current = onCounterProposalDragMove;
  onCounterProposalDragEndRef.current = onCounterProposalDragEnd;

  useEffect(() => {
    const button = fullscreenBtnRef.current;
    if (!button) return;

    button.innerHTML = isFullscreen ? EXIT_ICON : EXPAND_ICON;
    button.title = isFullscreen ? "Exit fullscreen" : "Fullscreen";
    button.setAttribute(
      "aria-label",
      isFullscreen ? "Exit fullscreen map" : "Expand map to fullscreen"
    );
  }, [isFullscreen]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const frame = requestAnimationFrame(() => {
      map.resize();
      const width = containerRef.current?.clientWidth ?? 0;
      applyLabelScale(map, labelScreenScale(width));
    });

    return () => cancelAnimationFrame(frame);
  }, [isFullscreen]);

  useEffect(() => {
    if (!isMapReadyRef.current || !applySelectionRef.current) {
      return;
    }

    applySelectionRef.current(selection);
  }, [selection, mapReadyTick]);

  useEffect(() => {
    if (!isMapReadyRef.current || !applyExternalHoverRef.current) {
      return;
    }

    applyExternalHoverRef.current(externalHoverSelection);
  }, [externalHoverSelection, mapReadyTick]);

  useEffect(() => {
    if (!isMapReadyRef.current || !applyObjectionPreviewRef.current) {
      return;
    }

    applyObjectionPreviewRef.current(objectionPreview);
  }, [mapReadyTick, objectionPreview]);

  useEffect(() => {
    if (!isMapReadyRef.current || !applyCounterProposalPreviewRef.current) {
      return;
    }

    applyCounterProposalPreviewRef.current(counterProposalPreview);
  }, [counterProposalPreview, mapReadyTick]);

  useEffect(() => {
    const setFedState = setFedStateRef.current;

    if (!setFedState || !isMapReadyRef.current) {
      return undefined;
    }

    const safeSetFedState = (fedNum, state) => {
      try {
        setFedState(fedNum, state);
      } catch {
        return;
      }
    };

    if (blinkIntervalRef.current) {
      window.clearInterval(blinkIntervalRef.current);
      blinkIntervalRef.current = null;
    }

    const allAreas = getAllRolloutAreas();

    allAreas.forEach((area) => {
      safeSetFedState(area.fedNum, {
        rolloutVisible: true,
        rolloutColor: getRolloutColor(area.categoryId),
        blinkHidden: false
      });
    });

    if (!rolloutEnabled) {
      return undefined;
    }

    const activeAreas = rolloutCategoryId ? getRolloutAreas(rolloutCategoryId) : [];

    if (!activeAreas.length) {
      return undefined;
    }

    let isHidden = false;
    blinkIntervalRef.current = window.setInterval(() => {
      isHidden = !isHidden;
      activeAreas.forEach((area) => {
        safeSetFedState(area.fedNum, {
          blinkHidden: isHidden
        });
      });
    }, 520);

    return () => {
      if (blinkIntervalRef.current) {
        window.clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }

      activeAreas.forEach((area) => {
        safeSetFedState(area.fedNum, {
          blinkHidden: false
        });
      });
    };
  }, [mapReadyTick, rolloutCategoryId, rolloutEnabled]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: WHITE_BASEMAP_STYLE,
      center: [-135, 63.5],
      zoom: 5,
      minZoom: 1,
      maxZoom: 14,
      renderWorldCopies: false,
      maxPitch: 0
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      createFullscreenControl(
        fullscreenBtnRef,
        () => isFullscreenRef.current,
        () => onToggleFullscreenRef.current?.()
      ),
      "top-right"
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    function fedFeatureTarget(fedId) {
      const target = { source: "fed-2023", id: fedId };
      if (fedSourceModeRef.current === "pmtiles") {
        target.sourceLayer = FED_SOURCE_LAYER;
      }
      return target;
    }

    function setFedFeatureState(fedId, state) {
      map.setFeatureState(fedFeatureTarget(fedId), state);
    }

    function clearFedFeatureState(fedId) {
      map.removeFeatureState(fedFeatureTarget(fedId));
    }

    setFedStateRef.current = setFedFeatureState;

    function normalizeDaId(target) {
      if (!target) {
        return null;
      }

      return target.type === "da" ? target.dguid ?? target.id ?? null : null;
    }

    function normalizeFedId(target) {
      if (!target || target.type !== "fed") {
        return null;
      }

      const fedNum = target.fedNum ?? target.id ?? null;
      return fedNum != null ? String(fedNum) : null;
    }

    function addFedFillLayer(useVectorTiles) {
      const layer = {
        id: "fed-fill",
        type: "fill",
        source: "fed-2023",
        paint: fedFillPaint()
      };
      if (useVectorTiles) {
        layer["source-layer"] = FED_SOURCE_LAYER;
      }
      map.addLayer(layer);
    }

    function addFedOutlineLayer(useVectorTiles) {
      if (!useVectorTiles) return;
      map.addLayer({
        id: "fed-outline",
        type: "line",
        source: "fed-2023",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: fedOutlinePaint(),
        "source-layer": FED_SOURCE_LAYER
      });
    }

    async function addFedBaseLayers() {
      const usePmtiles = await mapApi.supportsByteServing("fed_boundaries_2023.pmtiles");
      fedSourceModeRef.current = usePmtiles ? "pmtiles" : "geojson";

      if (usePmtiles) {
        const pmtilesHttpUrl = mapApi.absoluteAssetUrl("fed_boundaries_2023.pmtiles");
        map.addSource("fed-2023", {
          type: "vector",
          url: `pmtiles://${pmtilesHttpUrl}`,
          promoteId: { [FED_SOURCE_LAYER]: "fed_num" }
        });
        addFedFillLayer(true);
        addFedOutlineLayer(true);
        return "pmtiles";
      }

      const fedGeojson = await mapApi.fetchAssetJson("fed_boundaries_2023.geojson");
      map.addSource("fed-2023", {
        type: "geojson",
        data: fedGeojson,
        promoteId: "fed_num"
      });
      addFedFillLayer(false);
      return "geojson";
    }

    function addDaLayers(daGeojson) {
      map.addSource("das", {
        type: "geojson",
        data: daGeojson,
        promoteId: "DGUID"
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
            "#4e79a7"
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.85,
            ["boolean", ["feature-state", "hover"], false],
            0.72,
            0.55
          ],
          "fill-antialias": true
        }
      });

      map.addLayer({
        id: "da-outline",
        type: "line",
        source: "das",
        layout: {
          visibility: "none",
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            MAP_BOUNDARY_COLOR,
            ["boolean", ["feature-state", "hover"], false],
            MAP_BOUNDARY_COLOR,
            MAP_BOUNDARY_COLOR
          ],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            OUTLINE_ZOOM.DA_MIN,
            0,
            OUTLINE_ZOOM.DA_MIN + 2,
            ["case", ["boolean", ["feature-state", "selected"], false], 1.6, 0.9]
          ],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            OUTLINE_ZOOM.DA_MIN,
            0,
            OUTLINE_ZOOM.DA_MIN + 1,
            1
          ]
        }
      });
    }

    function addObjectionBoundaryLayers() {
      map.addSource("objection-boundary", {
        type: "geojson",
        data: EMPTY_OBJECTION_BOUNDARY
      });

      map.addLayer({
        id: "objection-boundary-glow",
        type: "line",
        source: "objection-boundary",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#ff4b4b",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            6,
            8,
            12
          ],
          "line-opacity": 0.32,
          "line-blur": 1.2
        }
      });

      map.addLayer({
        id: "objection-boundary-line",
        type: "line",
        source: "objection-boundary",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#d93025",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            2.4,
            8,
            4.4
          ],
          "line-opacity": 1
        }
      });
    }

    function addCounterProposalLayers() {
      map.addSource("counter-proposal", {
        type: "geojson",
        data: EMPTY_COUNTER_PROPOSAL_FEATURES,
        promoteId: "DGUID",
      });

      map.addLayer({
        id: "counter-proposal-fill",
        type: "fill",
        source: "counter-proposal",
        paint: {
          "fill-color": "#7aa8f8",
          "fill-opacity": 0.58,
          "fill-outline-color": MAP_BOUNDARY_COLOR,
        },
      });

      map.addLayer({
        id: "counter-proposal-outline",
        type: "line",
        source: "counter-proposal",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": MAP_BOUNDARY_COLOR,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            1.2,
            8,
            2.2,
            11,
            3.2,
          ],
          "line-opacity": 1,
        },
      });

      map.addSource("counter-proposal-boundary", {
        type: "geojson",
        data: EMPTY_OBJECTION_BOUNDARY,
      });

      map.addLayer({
        id: "counter-proposal-boundary-glow",
        type: "line",
        source: "counter-proposal-boundary",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#ff4b4b",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            8,
            8,
            14,
          ],
          "line-opacity": 0.26,
          "line-blur": 1.1,
        },
      });

      map.addLayer({
        id: "counter-proposal-boundary-line",
        type: "line",
        source: "counter-proposal-boundary",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#d93025",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            2.8,
            8,
            5,
          ],
          "line-opacity": 1,
        },
      });

      map.addSource("counter-proposal-handles", {
        type: "geojson",
        data: EMPTY_COUNTER_PROPOSAL_FEATURES,
      });

      map.addLayer({
        id: "counter-proposal-handles",
        type: "circle",
        source: "counter-proposal-handles",
        paint: {
          "circle-radius": [
            "case",
            ["boolean", ["get", "selected"], false],
            8,
            6,
          ],
          "circle-color": [
            "case",
            ["boolean", ["get", "selected"], false],
            "#1a73e8",
            "#ffffff",
          ],
          "circle-stroke-width": [
            "case",
            ["boolean", ["get", "selected"], false],
            3,
            2,
          ],
          "circle-stroke-color": "#1a73e8",
          "circle-opacity": 0.98,
        },
      });
    }

    function syncDaOutlineVisibility() {
      if (!map.getLayer("da-outline")) return;
      const visible = map.getZoom() >= OUTLINE_ZOOM.DA_MIN ? "visible" : "none";
      map.setLayoutProperty("da-outline", "visibility", visible);
    }

    function addFedLabelLayers(geojson, scale) {
      map.addSource("fed-labels", { type: "geojson", data: geojson });

      map.addLayer({
        id: "fed-labels-national",
        type: "symbol",
        source: "fed-labels",
        minzoom: FED_LABEL_ZOOM.NATIONAL_MIN,
        maxzoom: FED_LABEL_ZOOM.NATIONAL_MAX,
        layout: fedNationalLabelLayout(scale),
        paint: fedNationalLabelPaint()
      });

      map.addLayer({
        id: "fed-labels-local",
        type: "symbol",
        source: "fed-labels",
        minzoom: FED_LABEL_ZOOM.LOCAL_MIN,
        maxzoom: FED_LABEL_ZOOM.LOCAL_MAX,
        layout: fedLocalLabelLayout(scale),
        paint: fedLocalLabelPaint()
      });
    }

    function addDaLabelLayers(geojson, scale) {
      if (!geojson.features.length) return { community: 0, code: 0 };

      map.addSource("da-labels-yt", { type: "geojson", data: geojson });

      map.addLayer({
        id: "da-labels-community",
        type: "symbol",
        source: "da-labels-yt",
        minzoom: DA_LABEL_ZOOM.COMMUNITY_MIN,
        maxzoom: DA_LABEL_ZOOM.MAX,
        filter: ["==", ["get", "kind"], "community"],
        layout: daCommunityLabelLayout(scale),
        paint: daCommunityLabelPaint()
      });

      map.addLayer({
        id: "da-labels-code",
        type: "symbol",
        source: "da-labels-yt",
        minzoom: DA_LABEL_ZOOM.CODE_MIN,
        maxzoom: DA_LABEL_ZOOM.MAX,
        filter: ["==", ["get", "kind"], "code"],
        layout: daCodeLabelLayout(scale),
        paint: daCodeLabelPaint()
      });

      const community = geojson.features.filter(
        (feature) => feature.properties?.kind === "community"
      ).length;
      const code = geojson.features.length - community;

      return { community, code };
    }

    let labelResizeObserver = null;

    function syncLabelScale() {
      const width = containerRef.current?.clientWidth ?? 0;
      applyLabelScale(map, labelScreenScale(width));
    }

    function pickInteractiveFeature(point) {
      if (counterProposalPreviewRef.current?.editable) {
        const handleFeatures = map.queryRenderedFeatures(point, {
          layers: ["counter-proposal-handles"],
        });
        const handleId = handleFeatures[0]?.properties?.id;

        if (handleId) {
          return {
            type: "counter-proposal-handle",
            id: String(handleId),
          };
        }
      }

      const daFeatures = map.queryRenderedFeatures(point, { layers: ["da-fill"] });
      if (daFeatures.length) {
        const feature = daFeatures[0];
        const id = getFeatureId(feature, "DGUID");
        if (id) return { type: "da", id };
      }

      const fedFeatures = map.queryRenderedFeatures(point, { layers: ["fed-fill"] });
      if (fedFeatures.length) {
        const feature = fedFeatures[0];
        if (isMvpFed(feature.properties)) return null;
        const id = getFeatureId(feature, "fed_num");
        if (id) return { type: "fed", id };
      }

      return null;
    }

    function clearDaSelection() {
      const selected = selectionRef.current.da;
      if (selected === null || selected === undefined) return;
      map.setFeatureState({ source: "das", id: selected }, { selected: false });
      selectionRef.current.da = null;
    }

    function clearFedSelection() {
      const selected = selectionRef.current.fed;
      if (selected === null || selected === undefined) return;
      setFedFeatureState(selected, { selected: false });
      selectionRef.current.fed = null;
    }

    function clearAllSelection() {
      clearDaSelection();
      clearFedSelection();
    }

    function refreshDaHover(daId) {
      if (daId === null || daId === undefined) {
        return;
      }

      const shouldHover =
        hoverRef.current.da === daId || externalHoverRef.current.da === daId;
      map.setFeatureState({ source: "das", id: daId }, { hover: shouldHover });
    }

    function refreshFedHover(fedId) {
      if (fedId === null || fedId === undefined) {
        return;
      }

      const shouldHover =
        hoverRef.current.fed === fedId || externalHoverRef.current.fed === fedId;
      setFedFeatureState(fedId, { hover: shouldHover });
    }

    function setInternalHover(hit) {
      const nextDaId = normalizeDaId(hit);
      const nextFedId = normalizeFedId(hit);
      const previousDaId = hoverRef.current.da;
      const previousFedId = hoverRef.current.fed;

      hoverRef.current = { da: nextDaId, fed: nextFedId };

      if (previousDaId !== nextDaId) {
        refreshDaHover(previousDaId);
      }
      if (previousFedId !== nextFedId) {
        refreshFedHover(previousFedId);
      }
      if (nextDaId !== previousDaId) {
        refreshDaHover(nextDaId);
      }
      if (nextFedId !== previousFedId) {
        refreshFedHover(nextFedId);
      }
    }

    function setExternalHover(hit) {
      const nextDaId = normalizeDaId(hit);
      const nextFedId = normalizeFedId(hit);
      const previousDaId = externalHoverRef.current.da;
      const previousFedId = externalHoverRef.current.fed;

      externalHoverRef.current = { da: nextDaId, fed: nextFedId };

      if (previousDaId !== nextDaId) {
        refreshDaHover(previousDaId);
      }
      if (previousFedId !== nextFedId) {
        refreshFedHover(previousFedId);
      }
      if (nextDaId !== previousDaId) {
        refreshDaHover(nextDaId);
      }
      if (nextFedId !== previousFedId) {
        refreshFedHover(nextFedId);
      }
    }

    function applySelectionTarget(target) {
      clearAllSelection();

      const nextDaId = normalizeDaId(target);
      if (nextDaId !== null && nextDaId !== undefined) {
        selectionRef.current.da = nextDaId;
        map.setFeatureState({ source: "das", id: nextDaId }, { selected: true });
        return;
      }

      const nextFedId = normalizeFedId(target);
      if (nextFedId !== null && nextFedId !== undefined) {
        selectionRef.current.fed = nextFedId;
        setFedFeatureState(nextFedId, { selected: true });
      }
    }

    function applyObjectionPreview(nextPreview) {
      const source = map.getSource("objection-boundary");

      if (!source || typeof source.setData !== "function") {
        return;
      }

      source.setData(nextPreview?.boundaryGeoJson ?? EMPTY_OBJECTION_BOUNDARY);
    }

    function applyCounterProposalPreview(nextPreview) {
      const proposalSource = map.getSource("counter-proposal");
      const boundarySource = map.getSource("counter-proposal-boundary");
      const handleSource = map.getSource("counter-proposal-handles");

      if (proposalSource && typeof proposalSource.setData === "function") {
        proposalSource.setData(
          nextPreview?.featureCollection ?? EMPTY_COUNTER_PROPOSAL_FEATURES,
        );
      }

      if (boundarySource && typeof boundarySource.setData === "function") {
        boundarySource.setData(
          nextPreview?.boundaryGeoJson ?? EMPTY_OBJECTION_BOUNDARY,
        );
      }

      if (handleSource && typeof handleSource.setData === "function") {
        handleSource.setData(
          nextPreview?.handleFeatureCollection ?? EMPTY_COUNTER_PROPOSAL_FEATURES,
        );
      }

      if (nextPreview) {
        clearAllSelection();
        return;
      }

      applySelectionTarget(latestSelectionPropRef.current);
    }

    applySelectionRef.current = applySelectionTarget;
    applyExternalHoverRef.current = setExternalHover;
    applyObjectionPreviewRef.current = applyObjectionPreview;
    applyCounterProposalPreviewRef.current = applyCounterProposalPreview;

    const onClick = (event) => {
      if (skipNextClickRef.current) {
        skipNextClickRef.current = false;
        return;
      }

      const hit = pickInteractiveFeature(event.point);

      if (hit?.type === "counter-proposal-handle") {
        onCounterProposalHandleSelectRef.current?.(hit.id);
        return;
      }

      if (counterProposalPreviewRef.current) {
        return;
      }

      if (!hit) return;

      setInternalHover(null);
      applySelectionTarget(
        hit.type === "da"
          ? { type: "da", dguid: hit.id }
          : { type: "fed", fedNum: hit.id },
      );

      if (hit.type === "da") {
        onDaSelect?.(hit.id);
        return;
      }

      const fedName =
        fedNameLookupRef.current.get(String(hit.id)) || `FED ${hit.id}`;
      onFedSelect?.(hit.id, fedName);
    };

    const onMouseMove = (event) => {
      if (counterProposalDragRef.current) {
        counterProposalDragRef.current = {
          ...counterProposalDragRef.current,
          moved: true,
        };
        map.getCanvas().style.cursor = "grabbing";
        onCounterProposalDragMoveRef.current?.(counterProposalDragRef.current.id, [
          event.lngLat.lng,
          event.lngLat.lat,
        ]);
        return;
      }

      const hit = pickInteractiveFeature(event.point);

      if (hit?.type === "counter-proposal-handle") {
        map.getCanvas().style.cursor = "grab";
        setInternalHover(null);
        return;
      }

      if (!hit) {
        setInternalHover(null);
        map.getCanvas().style.cursor = "";
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      setInternalHover(hit);
    };

    const onMouseOut = () => {
      if (counterProposalDragRef.current) {
        return;
      }

      setInternalHover(null);
      map.getCanvas().style.cursor = "";
    };

    const onMouseDown = (event) => {
      const hit = pickInteractiveFeature(event.point);

      if (hit?.type !== "counter-proposal-handle") {
        return;
      }

      counterProposalDragRef.current = {
        id: hit.id,
        moved: false,
      };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
      onCounterProposalDragStartRef.current?.(hit.id);
      onCounterProposalHandleSelectRef.current?.(hit.id);
    };

    const onMouseUp = () => {
      if (!counterProposalDragRef.current) {
        return;
      }

      const { moved } = counterProposalDragRef.current;
      counterProposalDragRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      onCounterProposalDragEndRef.current?.();

      if (moved) {
        skipNextClickRef.current = true;
      }
    };

    const onZoom = () => syncDaOutlineVisibility();

    map.on("click", onClick);
    map.on("mousedown", onMouseDown);
    map.on("mouseup", onMouseUp);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);
    map.on("zoom", onZoom);

    map.on("load", async () => {
      try {
        const [daGeojson, fedLabels, profilePayload] = await Promise.all([
          mapApi.fetchAssetJson("single_fed_das.geojson"),
          mapApi.fetchAssetJson("fed_labels.geojson"),
          mapApi.getDaProfiles()
        ]);

        const daCount = daGeojson.features?.length ?? 0;
        if (daCount === 0) throw new Error("DA GeoJSON contains no features");

        const { index: profileIndex } = buildProfileIndex(profilePayload);
        fedNameLookupRef.current = buildFedNameLookup(fedLabels);

        const fedMode = await addFedBaseLayers();
        addDaLayers(daGeojson);
        addObjectionBoundaryLayers();
        addCounterProposalLayers();
        const initialLabelScale = labelScreenScale(containerRef.current?.clientWidth ?? 0);

        addFedLabelLayers(fedLabels, initialLabelScale);

        const daLabels = buildDaLabelGeoJSON(daGeojson, profileIndex);
        const daLabelCounts = addDaLabelLayers(daLabels, initialLabelScale);

        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          labelResizeObserver = new ResizeObserver(() => syncLabelScale());
          labelResizeObserver.observe(containerRef.current);
        }

        syncDaOutlineVisibility();

        const daBounds = extendBoundsFromGeoJSON(
          new maplibregl.LngLatBounds(),
          daGeojson
        );
        map.fitBounds(daBounds, { padding: 48, duration: 0 });
        map.setMaxBounds(
          paddedMaxBounds(
            new maplibregl.LngLatBounds(CANADA_BOUNDS.sw, CANADA_BOUNDS.ne),
            0.08
          )
        );

        onStatusChange?.(
          `Effective Area: Yukon FED (${MVP_FED_NUM}) - ${daCount} DAs`
        );
        isMapReadyRef.current = true;
        setMapReadyTick((current) => current + 1);

        console.log(
          `[OK] FED base: ${fedMode};`,
          daCount,
          "DA polygons on",
          FED_COUNT,
          "FED base;",
          fedLabels.features?.length ?? 0,
          "FED labels;",
          profileIndex.size,
          "DA profiles;",
          daLabelCounts.community,
          "community labels;",
          daLabelCounts.code,
          "code labels"
        );
      } catch (error) {
        console.error("[MapCanvas]", error);
        onStatusChange?.(`Error: ${error.message}`);
      }
    });

    return () => {
      labelResizeObserver?.disconnect();
      isMapReadyRef.current = false;
      if (blinkIntervalRef.current) {
        window.clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }
      setFedStateRef.current = null;
      applySelectionRef.current = null;
      applyExternalHoverRef.current = null;
      applyObjectionPreviewRef.current = null;
      applyCounterProposalPreviewRef.current = null;
      map.off("click", onClick);
      map.off("mousedown", onMouseDown);
      map.off("mouseup", onMouseUp);
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      map.off("zoom", onZoom);
      map.remove();
      mapRef.current = null;
      maplibregl.removeProtocol("pmtiles");
    };
  }, [onDaSelect, onFedSelect, onStatusChange]);

  return (
    <div className="map-canvas">
      <div ref={containerRef} className="map-canvas__viewport" aria-label="Electoral map" />
    </div>
  );
}
