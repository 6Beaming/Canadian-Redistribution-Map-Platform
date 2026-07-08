import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { mapApi } from "@/services/mapApi.js";
import {
  CANADA_BOUNDS,
  DATA_BLOCKED_FILL_COLOR,
  DEFAULT_DA_RENDER_MAX_ZOOM,
  DEFAULT_DA_RENDER_MIN_ZOOM,
  DEFAULT_DA_SOURCE_LAYER,
  ENABLED_FILL_COLOR,
  FED_COUNT,
  FED_SOURCE_LAYER,
  HOVER_COLOR,
  MAP_ZOOM,
  MVP_FED_NUM,
  SELECTED_COLOR,
  TRANSPARENT_INTERACTION_OPACITY,
  WHITE_BASEMAP_STYLE
} from "@/lib/map/constants.js";
import {
  getDaLabelGeojsonPath,
  getDaRenderMaxZoom,
  getDaRenderMinZoom,
  getDaRenderPmtilesPath,
  getDaRenderSourceLayer,
  getFallbackDaAssetManifest,
  normalizeDaAssetManifest,
} from "@/lib/map/daAssetManifest.js";
import {
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
import {
  buildGoogleRoadmapTileUrl,
  getGoogleRoadmapSession,
  hasGoogleMapTilesApiKey,
} from "@/services/googleMapTilesApi.js";
import "maplibre-gl/dist/maplibre-gl.css";
import daSubmissions from "../../data/map/indexes/da_submissions.json";

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>`;

const EXIT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M9 20H4v-5"/><path d="M15 20h5v-5"/></svg>`;

const BOUNDARY_ON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16"/><path d="M4 12h16"/></svg>`;

const BOUNDARY_OFF_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m6 6 12 12"/></svg>`;

const HEATMAP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1.4 2.1 3.2 3.7 3.2 6a3.2 3.2 0 1 1-6.4 0c0-1.2.5-2.3 1.4-3.5"/><path d="M8 14a4 4 0 0 0 8 0c0-1.4-.7-2.6-1.7-3.6"/><path d="M12 12c.8 1 1.8 1.8 1.8 3.2a1.8 1.8 0 1 1-3.6 0c0-.7.3-1.3.8-2"/></svg>`;

const MAP_BOUNDARY_COLOR = "#000000";
const TRANSPARENT_BOUNDARY_COLOR = "rgba(0, 0, 0, 0)";
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

function paddedMaxBounds(bounds, factor = 0.35) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const padLng = (ne.lng - sw.lng) * factor;
  const padLat = (ne.lat - sw.lat) * factor;
  const clampLatitude = (value) => Math.max(-89.75, Math.min(89.75, value));
  return new maplibregl.LngLatBounds(
    [sw.lng - padLng, clampLatitude(sw.lat - padLat)],
    [ne.lng + padLng, clampLatitude(ne.lat + padLat)]
  );
}

function createBoundaryControl(buttonRef, getBoundariesVisible, onToggle) {
  return {
    onAdd() {
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "maplibregl-ctrl-icon map-boundary-btn";
      button.innerHTML = getBoundariesVisible() ? BOUNDARY_ON_ICON : BOUNDARY_OFF_ICON;
      button.setAttribute(
        "aria-label",
        getBoundariesVisible() ? "Hide FED and DA boundaries" : "Show FED and DA boundaries",
      );
      button.setAttribute("aria-pressed", String(getBoundariesVisible()));
      button.title = getBoundariesVisible() ? "Hide boundaries" : "Show boundaries";
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

function createHeatmapControl(buttonRef, getHeatmapState, onToggle) {
  return {
    onAdd() {
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "maplibregl-ctrl-icon heatmap-button";
      button.innerHTML = HEATMAP_ICON;
      button.title = "Toggle submission heatmap";
      button.setAttribute("aria-label", "Toggle submission heatmap");
      button.setAttribute("aria-pressed", String(getHeatmapState()));
      button.classList.toggle("active", getHeatmapState());
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

function buildSubmissionCountExpression(submissionsByDguid) {
  const expression = ["match", ["to-string", ["get", "DGUID"]]];

  Object.entries(submissionsByDguid).forEach(([dguid, count]) => {
    expression.push(String(dguid), Number(count) || 0);
  });

  expression.push(0);
  return expression;
}

function buildRolloutFedMembershipExpression(fedNums, truthyValue, fallbackValue) {
  const expression = [
    "match",
    ["to-string", ["coalesce", ["get", "fed_num"], ["get", "FED_NUM"], MVP_FED_NUM]],
  ];

  fedNums.forEach((fedNum) => {
    expression.push(fedNum, truthyValue);
  });

  expression.push(fallbackValue);
  return expression;
}

function buildInitialMapBounds() {
  const sourceBounds = new maplibregl.LngLatBounds(CANADA_BOUNDS.sw, CANADA_BOUNDS.ne);
  const sw = sourceBounds.getSouthWest();
  const ne = sourceBounds.getNorthEast();
  const lngPad = (ne.lng - sw.lng) * 0.058;
  const southPad = (ne.lat - sw.lat) * 0.08;
  const northPad = (ne.lat - sw.lat) * 0.16;

  return new maplibregl.LngLatBounds(
    [sw.lng - lngPad, Math.max(-84.5, sw.lat - southPad)],
    [ne.lng + lngPad, Math.min(85.25, ne.lat + northPad)],
  );
}

function boundaryHighlightStateExpression() {
  return [
    "any",
    ["boolean", ["feature-state", "selected"], false],
    ["boolean", ["feature-state", "hover"], false],
  ];
}

function boundaryFillOutlineColor(showBoundaries) {
  if (showBoundaries) {
    return MAP_BOUNDARY_COLOR;
  }

  return [
    "case",
    boundaryHighlightStateExpression(),
    MAP_BOUNDARY_COLOR,
    TRANSPARENT_BOUNDARY_COLOR,
  ];
}

function boundaryLineOpacity(showBoundaries) {
  if (showBoundaries) {
    return 1;
  }

  return [
    "case",
    boundaryHighlightStateExpression(),
    1,
    0,
  ];
}

function fedNumMatch() {
  return ["==", ["to-string", ["get", "fed_num"]], MVP_FED_NUM];
}

const ENABLED_FED_NUMS = getRolloutAreas("enabled").map((area) => String(area.fedNum));
const BLOCKED_FED_NUMS = getRolloutAreas("data-blocked").map((area) =>
  String(area.fedNum),
);
const FED_ROLLOUT_FILL_EXPRESSION = buildRolloutFedMembershipExpression(
  ENABLED_FED_NUMS,
  ENABLED_FILL_COLOR,
  buildRolloutFedMembershipExpression(BLOCKED_FED_NUMS, DATA_BLOCKED_FILL_COLOR, "#ffffff"),
);

function buildBlockedDaFillExpression() {
  return buildRolloutFedMembershipExpression(
    BLOCKED_FED_NUMS,
    DATA_BLOCKED_FILL_COLOR,
    ENABLED_FILL_COLOR,
  );
}

const BLOCKED_DA_FILL_EXPRESSION = buildBlockedDaFillExpression();
const DA_SUBMISSION_COUNT_EXPRESSION = buildSubmissionCountExpression(daSubmissions);
const HEATMAP_DA_FILL_EXPRESSION = [
  "interpolate",
  ["linear"],
  DA_SUBMISSION_COUNT_EXPRESSION,
  0, "#fff7bc",
  10, "#fee391",
  25, "#fec44f",
  50, "#fe9929",
  75, "#ec7014",
  100, "#f03b20",
  150, "#de2d26",
  200, "#bd0026",
  220, "#800026",
];

function buildBlinkCategoryDaExpression(categoryId, hiddenValue, visibleValue) {
  if (categoryId === "enabled") {
    return buildRolloutFedMembershipExpression(
      ENABLED_FED_NUMS,
      hiddenValue,
      visibleValue,
    );
  }

  if (categoryId === "data-blocked") {
    return buildRolloutFedMembershipExpression(
      BLOCKED_FED_NUMS,
      hiddenValue,
      visibleValue,
    );
  }

  return visibleValue;
}

function fedFillPaint(showRollout, showBoundaries = true) {
  const fillColor = showRollout
    ? [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        SELECTED_COLOR,
        ["boolean", ["feature-state", "hover"], false],
        HOVER_COLOR,
        FED_ROLLOUT_FILL_EXPRESSION,
      ]
    : [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        SELECTED_COLOR,
        ["boolean", ["feature-state", "hover"], false],
        HOVER_COLOR,
        "#ffffff",
      ];

  const fillOpacity = showRollout
    ? [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.85,
        ["boolean", ["feature-state", "hover"], false],
        0.75,
        ["boolean", ["feature-state", "blinkHidden"], false],
        0.22,
        0.68,
      ]
    : [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.85,
        ["boolean", ["feature-state", "hover"], false],
        0.75,
        TRANSPARENT_INTERACTION_OPACITY,
      ];

  return {
    "fill-color": fillColor,
    "fill-outline-color": boundaryFillOutlineColor(showBoundaries),
    "fill-opacity": fillOpacity,
    "fill-antialias": true
  };
}

function fedOutlinePaint(showBoundaries = true) {
  return {
    "line-color": MAP_BOUNDARY_COLOR,
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      ["case", fedNumMatch(), 1.1, 0.7],
      4,
      ["case", fedNumMatch(), 1.8, 1.1],
      8,
      ["case", fedNumMatch(), 2.5, 1.6],
      12,
      ["case", fedNumMatch(), 3.2, 2.1]
    ],
    "line-opacity": boundaryLineOpacity(showBoundaries)
  };
}

function daFillPaint(
  showRollout,
  rolloutCategoryId = null,
  blinkHidden = false,
  showBoundaries = true,
  heatmapEnabled = false,
) {
  const fillColor = showRollout
    ? [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        SELECTED_COLOR,
        ["boolean", ["feature-state", "hover"], false],
        HOVER_COLOR,
        BLOCKED_DA_FILL_EXPRESSION,
      ]
    : heatmapEnabled
      ? [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          SELECTED_COLOR,
          ["boolean", ["feature-state", "hover"], false],
          HOVER_COLOR,
          HEATMAP_DA_FILL_EXPRESSION,
        ]
    : [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        SELECTED_COLOR,
        ["boolean", ["feature-state", "hover"], false],
        HOVER_COLOR,
        "#ffffff",
      ];

  const fillOpacity = showRollout
    ? [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.85,
        ["boolean", ["feature-state", "hover"], false],
        0.72,
        buildBlinkCategoryDaExpression(
          rolloutCategoryId,
          blinkHidden ? 0.18 : 0.58,
          0.58,
        ),
      ]
    : heatmapEnabled
      ? [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.88,
          ["boolean", ["feature-state", "hover"], false],
          0.82,
          0.74,
        ]
    : [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.85,
        ["boolean", ["feature-state", "hover"], false],
        0.72,
        TRANSPARENT_INTERACTION_OPACITY,
      ];

  return {
    "fill-color": fillColor,
    "fill-opacity": fillOpacity,
    "fill-outline-color": boundaryFillOutlineColor(showBoundaries),
    "fill-antialias": true,
  };
}

function daOutlinePaint(minZoom = DEFAULT_DA_RENDER_MIN_ZOOM, showBoundaries = true) {
  return {
    "line-color": MAP_BOUNDARY_COLOR,
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      minZoom,
      0.7,
      minZoom + 5,
      1.05,
      minZoom + 10,
      1.45,
    ],
    "line-opacity": boundaryLineOpacity(showBoundaries),
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
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const heatmapEnabledRef = useRef(false);
  const heatmapButtonRef = useRef(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const fullscreenBtnRef = useRef(null);
  const boundaryBtnRef = useRef(null);
  const onToggleFullscreenRef = useRef(onToggleFullscreen);
  const onDaSelectRef = useRef(onDaSelect);
  const onFedSelectRef = useRef(onFedSelect);
  const onStatusChangeRef = useRef(onStatusChange);
  const isFullscreenRef = useRef(isFullscreen);
  const boundariesVisibleRef = useRef(true);
  const fedNameLookupRef = useRef(new Map());
  const latestSelectionPropRef = useRef(selection);
  const selectionRef = useRef({ da: null, fed: null });
  const hoverRef = useRef({ da: null, fed: null });
  const externalHoverRef = useRef({ da: null, fed: null });
  const fedSourceModeRef = useRef("pmtiles");
  const daSourceModeRef = useRef("geojson");
  const daSourceLayerRef = useRef(DEFAULT_DA_SOURCE_LAYER);
  const setFedStateRef = useRef(null);
  const applyPresentationModeRef = useRef(null);
  const applyBoundaryVisibilityRef = useRef(null);
  const applyHeatmapModeRef = useRef(null);
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
  const [boundariesVisible, setBoundariesVisible] = useState(true);

  onToggleFullscreenRef.current = onToggleFullscreen;
  isFullscreenRef.current = isFullscreen;
  latestSelectionPropRef.current = selection;
  counterProposalPreviewRef.current = counterProposalPreview;
  onCounterProposalHandleSelectRef.current = onCounterProposalHandleSelect;
  onCounterProposalDragStartRef.current = onCounterProposalDragStart;
  onCounterProposalDragMoveRef.current = onCounterProposalDragMove;
  onCounterProposalDragEndRef.current = onCounterProposalDragEnd;
  onDaSelectRef.current = onDaSelect;
  onFedSelectRef.current = onFedSelect;
  onStatusChangeRef.current = onStatusChange;
  boundariesVisibleRef.current = boundariesVisible;
  heatmapEnabledRef.current = heatmapEnabled;

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
    const button = boundaryBtnRef.current;
    if (!button) return;

    button.innerHTML = boundariesVisible ? BOUNDARY_ON_ICON : BOUNDARY_OFF_ICON;
    button.title = boundariesVisible ? "Hide boundaries" : "Show boundaries";
    button.setAttribute(
      "aria-label",
      boundariesVisible ? "Hide FED and DA boundaries" : "Show FED and DA boundaries",
    );
    button.setAttribute("aria-pressed", String(boundariesVisible));
  }, [boundariesVisible]);

  useEffect(() => {
    const button = heatmapButtonRef.current;
    if (!button) return;

    button.classList.toggle("active", heatmapEnabled);
    button.setAttribute("aria-pressed", String(heatmapEnabled));
  }, [heatmapEnabled]);

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
    if (!isMapReadyRef.current || !applyPresentationModeRef.current) {
      return;
    }

    applyPresentationModeRef.current(rolloutEnabled);
  }, [mapReadyTick, rolloutEnabled]);

  useEffect(() => {
    if (!isMapReadyRef.current || !applyBoundaryVisibilityRef.current) {
      return;
    }

    applyBoundaryVisibilityRef.current(boundariesVisible);
  }, [boundariesVisible, mapReadyTick]);

  useEffect(() => {
    if (!isMapReadyRef.current || !applyHeatmapModeRef.current) {
      return;
    }

    applyHeatmapModeRef.current(heatmapEnabled);
  }, [heatmapEnabled, mapReadyTick]);

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
      if (mapRef.current?.getLayer("da-fill")) {
        mapRef.current.setPaintProperty(
          "da-fill",
          "fill-opacity",
          daFillPaint(
            false,
            rolloutCategoryId,
            false,
            boundariesVisibleRef.current,
            heatmapEnabledRef.current,
          )["fill-opacity"],
        );
      }
      return undefined;
    }

    const activeAreas = rolloutCategoryId ? getRolloutAreas(rolloutCategoryId) : [];

    if (!activeAreas.length) {
      if (mapRef.current?.getLayer("da-fill")) {
        mapRef.current.setPaintProperty(
          "da-fill",
          "fill-opacity",
          daFillPaint(
            true,
            rolloutCategoryId,
            false,
            boundariesVisibleRef.current,
            heatmapEnabledRef.current,
          )["fill-opacity"],
        );
      }
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

      if (mapRef.current?.getLayer("da-fill")) {
        mapRef.current.setPaintProperty(
          "da-fill",
          "fill-opacity",
          daFillPaint(
            true,
            rolloutCategoryId,
            isHidden,
            boundariesVisibleRef.current,
            heatmapEnabledRef.current,
          )["fill-opacity"],
        );
      }
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

      if (mapRef.current?.getLayer("da-fill")) {
        mapRef.current.setPaintProperty(
          "da-fill",
          "fill-opacity",
          daFillPaint(
            rolloutEnabled,
            rolloutCategoryId,
            false,
            boundariesVisibleRef.current,
            heatmapEnabledRef.current,
          )["fill-opacity"],
        );
      }
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
      zoom: MAP_ZOOM.INITIAL,
      minZoom: MAP_ZOOM.MIN,
      maxZoom: MAP_ZOOM.MAX,
      renderWorldCopies: false,
      maxPitch: 0,
      attributionControl: false,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(
      createFullscreenControl(
        fullscreenBtnRef,
        () => isFullscreenRef.current,
        () => onToggleFullscreenRef.current?.()
      ),
      "top-right"
    );
    map.addControl(
      createBoundaryControl(
        boundaryBtnRef,
        () => boundariesVisibleRef.current,
        () => setBoundariesVisible((current) => !current),
      ),
      "top-right"
    );
    map.addControl(
      createHeatmapControl(
        heatmapButtonRef,
        () => heatmapEnabledRef.current,
        () => setHeatmapEnabled((current) => !current),
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

    function daFeatureTarget(daId) {
      const target = { source: "das", id: daId };
      if (daSourceModeRef.current === "pmtiles") {
        target.sourceLayer = daSourceLayerRef.current;
      }
      return target;
    }

    function setFedFeatureState(fedId, state) {
      map.setFeatureState(fedFeatureTarget(fedId), state);
    }

    function setDaFeatureState(daId, state) {
      map.setFeatureState(daFeatureTarget(daId), state);
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
        paint: fedFillPaint(rolloutEnabled, boundariesVisibleRef.current)
      };
      if (useVectorTiles) {
        layer["source-layer"] = FED_SOURCE_LAYER;
      }
      map.addLayer(layer);
    }

    function addFedOutlineLayer(useVectorTiles) {
      const layer = {
        id: "fed-outline",
        type: "line",
        source: "fed-2023",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: fedOutlinePaint(boundariesVisibleRef.current),
      };

      if (useVectorTiles) {
        layer["source-layer"] = FED_SOURCE_LAYER;
      }

      map.addLayer(layer);
    }

    function addDaFillLayer(useVectorTiles, sourceLayer, minZoom) {
      const layer = {
        id: "da-fill",
        type: "fill",
        source: "das",
        paint: daFillPaint(
          rolloutEnabled,
          rolloutCategoryId,
          false,
          boundariesVisibleRef.current,
          heatmapEnabledRef.current,
        ),
        minzoom: minZoom,
      };

      if (useVectorTiles) {
        layer["source-layer"] = sourceLayer;
      }

      map.addLayer(layer);
    }

    function addDaOutlineLayer(useVectorTiles, sourceLayer, minZoom) {
      const layer = {
        id: "da-outline",
        type: "line",
        source: "das",
        minzoom: minZoom,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: daOutlinePaint(minZoom, boundariesVisibleRef.current),
      };

      if (useVectorTiles) {
        layer["source-layer"] = sourceLayer;
      }

      map.addLayer(layer);
    }

    async function addGoogleBasemapLayers() {
      if (!hasGoogleMapTilesApiKey()) {
        return false;
      }

      const [labelSession, mutedSession] = await Promise.all([
        getGoogleRoadmapSession({ labelsVisible: true }),
        getGoogleRoadmapSession({ labelsVisible: false }),
      ]);
      const attribution = "Map data (c) Google";

      map.addSource("google-roadmap-labels", {
        type: "raster",
        tiles: [buildGoogleRoadmapTileUrl(labelSession.session)],
        tileSize: Number(labelSession.tileWidth ?? 256),
        attribution,
        scheme: "xyz",
      });
      map.addLayer(
        {
          id: "google-roadmap-labels",
          type: "raster",
          source: "google-roadmap-labels",
          layout: {
            visibility: rolloutEnabled ? "none" : "visible",
          },
          paint: {
            "raster-opacity": 1,
          },
        },
        "fed-fill",
      );

      map.addSource("google-roadmap-muted", {
        type: "raster",
        tiles: [buildGoogleRoadmapTileUrl(mutedSession.session)],
        tileSize: Number(mutedSession.tileWidth ?? 256),
        attribution,
        scheme: "xyz",
      });
      map.addLayer(
        {
          id: "google-roadmap-muted",
          type: "raster",
          source: "google-roadmap-muted",
          layout: {
            visibility: rolloutEnabled ? "visible" : "none",
          },
          paint: {
            "raster-opacity": 1,
          },
        },
        "fed-fill",
      );

      return true;
    }

    async function addFedBaseLayers() {
      const usePmtiles = await mapApi.supportsByteServing("reference/fed_boundaries_2023.pmtiles");
      fedSourceModeRef.current = usePmtiles ? "pmtiles" : "geojson";

      if (usePmtiles) {
        const pmtilesHttpUrl = mapApi.absoluteAssetUrl("reference/fed_boundaries_2023.pmtiles");
        map.addSource("fed-2023", {
          type: "vector",
          url: `pmtiles://${pmtilesHttpUrl}`,
          promoteId: { [FED_SOURCE_LAYER]: "fed_num" }
        });
        addFedFillLayer(true);
        addFedOutlineLayer(true);
        return "pmtiles";
      }

      const fedGeojson = await mapApi.fetchAssetJson("reference/fed_boundaries_2023.geojson");
      map.addSource("fed-2023", {
        type: "geojson",
        data: fedGeojson,
        promoteId: "fed_num"
      });
      addFedFillLayer(false);
      addFedOutlineLayer(false);
      return "geojson";
    }

    async function addDaLayers(assetManifest) {
      const normalizedManifest = normalizeDaAssetManifest(assetManifest);
      const pmtilesPath = getDaRenderPmtilesPath(normalizedManifest);
      const sourceLayer =
        getDaRenderSourceLayer(normalizedManifest) || DEFAULT_DA_SOURCE_LAYER;
      const minZoom = Math.max(
        Number(getDaRenderMinZoom(normalizedManifest)) || DEFAULT_DA_RENDER_MIN_ZOOM,
        MAP_ZOOM.MIN,
      );
      const maxZoom = Math.min(
        Number(getDaRenderMaxZoom(normalizedManifest)) || DEFAULT_DA_RENDER_MAX_ZOOM,
        MAP_ZOOM.MAX + 1,
      );

      daSourceLayerRef.current = sourceLayer;

      if (!pmtilesPath) {
        throw new Error(
          "The DA asset manifest does not declare a PMTiles render bundle. Rebuild the local DA render assets first.",
        );
      }

      if (!(await mapApi.supportsByteServing(pmtilesPath))) {
        throw new Error(
          "The DA PMTiles bundle is unavailable or byte-range serving is disabled. Verify /api/map/assets supports Range requests.",
        );
      }

      daSourceModeRef.current = "pmtiles";
      map.addSource("das", {
        type: "vector",
        url: `pmtiles://${mapApi.absoluteAssetUrl(pmtilesPath)}`,
        promoteId: { [sourceLayer]: "DGUID" },
      });
      addDaFillLayer(true, sourceLayer, minZoom);
      addDaOutlineLayer(true, sourceLayer, minZoom);

      return {
        mode: "pmtiles",
        featureCount: normalizedManifest.assets.reduce(
          (count, asset) => count + Math.max(0, Number(asset.featureCount ?? 0)),
          0,
        ),
        minZoom,
        maxZoom,
        sourceLayer,
      };
    }

    function setPresentationMode(showRollout) {
      if (map.getLayer("fed-fill")) {
        map.setPaintProperty(
          "fed-fill",
          "fill-color",
          fedFillPaint(showRollout, boundariesVisibleRef.current)["fill-color"],
        );
        map.setPaintProperty(
          "fed-fill",
          "fill-outline-color",
          fedFillPaint(showRollout, boundariesVisibleRef.current)["fill-outline-color"],
        );
        map.setPaintProperty(
          "fed-fill",
          "fill-opacity",
          fedFillPaint(showRollout, boundariesVisibleRef.current)["fill-opacity"],
        );
      }

      if (map.getLayer("da-fill")) {
        map.setPaintProperty(
          "da-fill",
          "fill-color",
          daFillPaint(
            showRollout,
            rolloutCategoryId,
            false,
            boundariesVisibleRef.current,
            heatmapEnabledRef.current,
          )["fill-color"],
        );
        map.setPaintProperty(
          "da-fill",
          "fill-opacity",
          daFillPaint(
            showRollout,
            rolloutCategoryId,
            false,
            boundariesVisibleRef.current,
            heatmapEnabledRef.current,
          )["fill-opacity"],
        );
        map.setPaintProperty(
          "da-fill",
          "fill-outline-color",
          daFillPaint(
            showRollout,
            rolloutCategoryId,
            false,
            boundariesVisibleRef.current,
            heatmapEnabledRef.current,
          )["fill-outline-color"],
        );
      }

      [
        "fed-labels-national",
        "fed-labels-local",
        "da-labels-community",
        "da-labels-code",
      ].forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", showRollout ? "visible" : "none");
        }
      });

      if (map.getLayer("google-roadmap-labels")) {
        map.setLayoutProperty(
          "google-roadmap-labels",
          "visibility",
          showRollout ? "none" : "visible",
        );
      }

      if (map.getLayer("google-roadmap-muted")) {
        map.setLayoutProperty(
          "google-roadmap-muted",
          "visibility",
          showRollout ? "visible" : "none",
        );
      }
    }

    function setHeatmapMode(enabled) {
      if (!map.getLayer("da-fill")) {
        return;
      }

      const nextPaint = daFillPaint(
        rolloutEnabled,
        rolloutCategoryId,
        false,
        boundariesVisibleRef.current,
        enabled,
      );

      map.setPaintProperty("da-fill", "fill-color", nextPaint["fill-color"]);
      map.setPaintProperty("da-fill", "fill-opacity", nextPaint["fill-opacity"]);
      map.setPaintProperty(
        "da-fill",
        "fill-outline-color",
        nextPaint["fill-outline-color"],
      );
    }

    function applyBoundaryVisibility(showBoundaries) {
      if (map.getLayer("fed-fill")) {
        map.setPaintProperty(
          "fed-fill",
          "fill-outline-color",
          boundaryFillOutlineColor(showBoundaries),
        );
      }

      if (map.getLayer("da-fill")) {
        map.setPaintProperty(
          "da-fill",
          "fill-outline-color",
          boundaryFillOutlineColor(showBoundaries),
        );
      }

      if (map.getLayer("fed-outline")) {
        map.setLayoutProperty("fed-outline", "visibility", "visible");
        map.setPaintProperty("fed-outline", "line-opacity", boundaryLineOpacity(showBoundaries));
      }

      if (map.getLayer("da-outline")) {
        map.setLayoutProperty("da-outline", "visibility", "visible");
        map.setPaintProperty("da-outline", "line-opacity", boundaryLineOpacity(showBoundaries));
      }
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
      map.setLayoutProperty("da-outline", "visibility", "visible");
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
      if (!geojson?.features?.length) return { community: 0, code: 0 };

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
      if (counterProposalPreviewRef.current?.editable && map.getLayer("counter-proposal-handles")) {
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

      const daFeatures = map.getLayer("da-fill")
        ? map.queryRenderedFeatures(point, { layers: ["da-fill"] })
        : [];
      if (daFeatures.length) {
        const feature = daFeatures[0];
        const id = getFeatureId(feature, "DGUID");
        if (id) return { type: "da", id };
      }

      const fedFeatures = map.getLayer("fed-fill")
        ? map.queryRenderedFeatures(point, { layers: ["fed-fill"] })
        : [];
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
      setDaFeatureState(selected, { selected: false });
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
      setDaFeatureState(daId, { hover: shouldHover });
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
        setDaFeatureState(nextDaId, { selected: true });
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
    applyPresentationModeRef.current = setPresentationMode;
    applyBoundaryVisibilityRef.current = applyBoundaryVisibility;
    applyHeatmapModeRef.current = setHeatmapMode;

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
        onDaSelectRef.current?.(hit.id);
        return;
      }

      const fedName =
        fedNameLookupRef.current.get(String(hit.id)) || `FED ${hit.id}`;
      onFedSelectRef.current?.(hit.id, fedName);
    };

    const pushCounterProposalDragMove = (nextCoordinate) => {
      counterProposalDragRef.current = {
        ...counterProposalDragRef.current,
        moved: true,
      };
      map.getCanvas().style.cursor = "grabbing";
      onCounterProposalDragMoveRef.current?.(
        counterProposalDragRef.current.id,
        nextCoordinate,
      );
    };

    const onMouseMove = (event) => {
      if (counterProposalDragRef.current) {
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

    const onWindowMouseMove = (event) => {
      if (!counterProposalDragRef.current) {
        return;
      }

      const canvasRect = map.getCanvas().getBoundingClientRect();
      const projectedPoint = [
        event.clientX - canvasRect.left,
        event.clientY - canvasRect.top,
      ];
      const lngLat = map.unproject(projectedPoint);

      pushCounterProposalDragMove([lngLat.lng, lngLat.lat]);
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
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    map.on("load", async () => {
      try {
        const [assetManifestPayload, fedLabels, profilePayload] = await Promise.all([
          mapApi.getDaAssetManifest().catch(() => getFallbackDaAssetManifest()),
          mapApi.fetchAssetJson("reference/fed_labels.geojson"),
          mapApi.getDaProfiles()
        ]);

        const assetManifest = normalizeDaAssetManifest(assetManifestPayload);
        const { index: profileIndex } = buildProfileIndex(profilePayload);
        fedNameLookupRef.current = buildFedNameLookup(fedLabels);

        const fedMode = await addFedBaseLayers();
        const googleBasemapEnabled = await addGoogleBasemapLayers().catch((error) => {
          console.warn("[MapCanvas] Google Map Tiles basemap unavailable:", error);
          onStatusChangeRef.current?.(`Google basemap unavailable: ${error.message}`);
          return false;
        });
        const daBundle = await addDaLayers(assetManifest);
        addObjectionBoundaryLayers();
        addCounterProposalLayers();
        const initialLabelScale = labelScreenScale(containerRef.current?.clientWidth ?? 0);

        addFedLabelLayers(fedLabels, initialLabelScale);

        let daLabels = null;
        const labelGeojsonPath = getDaLabelGeojsonPath(assetManifest);

        if (labelGeojsonPath && (await mapApi.assetExists(labelGeojsonPath))) {
          daLabels = await mapApi.fetchAssetJson(labelGeojsonPath);
        }

        const daLabelCounts = addDaLabelLayers(daLabels, initialLabelScale);

        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          labelResizeObserver = new ResizeObserver(() => syncLabelScale());
          labelResizeObserver.observe(containerRef.current);
        }

        syncDaOutlineVisibility();
        setPresentationMode(rolloutEnabled);
        applyBoundaryVisibility(boundariesVisibleRef.current);

        const initialBounds = buildInitialMapBounds();
        map.fitBounds(initialBounds, {
          padding: { top: 92, right: 64, bottom: 72, left: 64 },
          duration: 0,
        });

        map.setMaxBounds(
          paddedMaxBounds(
            initialBounds,
            0.24
          )
        );

        const daCount =
          daBundle.featureCount ||
          assetManifest.assets.reduce(
            (count, asset) => count + Math.max(0, Number(asset.featureCount ?? 0)),
            0,
          ) ||
          profileIndex.size ||
          0;

        onStatusChangeRef.current?.(
          `Map ready: ${daCount} DA features across ${assetManifest.assets.length} metadata group(s).`
        );
        isMapReadyRef.current = true;
        setMapReadyTick((current) => current + 1);

        console.log(
          `[OK] FED base: ${fedMode};`,
          googleBasemapEnabled ? "Google roadmap basemap enabled;" : "Google roadmap basemap disabled;",
          daBundle.mode,
          "DA render mode;",
          daCount,
          "DA polygons on",
          FED_COUNT,
          "FED base;",
          fedLabels.features?.length ?? 0,
          "FED labels;",
          profileIndex.size,
          "DA profiles;",
          assetManifest.assets.length,
          "metadata groups;",
          "render minzoom",
          daBundle.minZoom,
          "render maxzoom",
          daBundle.maxZoom,
          daLabelCounts.community,
          "community labels;",
          daLabelCounts.code,
          "code labels"
        );
      } catch (error) {
        console.error("[MapCanvas]", error);
        onStatusChangeRef.current?.(`Error: ${error.message}`);
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
      applyPresentationModeRef.current = null;
      applyBoundaryVisibilityRef.current = null;
      applyHeatmapModeRef.current = null;
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
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      map.remove();
      mapRef.current = null;
      maplibregl.removeProtocol("pmtiles");
    };
  }, []);

  return (
    <div className="map-canvas">
      <div ref={containerRef} className="map-canvas__viewport" aria-label="Electoral map" />
    </div>
  );
}
