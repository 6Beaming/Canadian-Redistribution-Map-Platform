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
  isDataBlockedFed,
  isEnabledFed,
} from "@/lib/map/rolloutPlan.js";
import {
  canInteractWithDa,
  canInteractWithFed,
  isMapFeatureInteractionLocked,
  MAP_INTERACTION_MODE,
} from "@/lib/map/interactionMode.js";
import {
  buildSubmissionHeatmapFillExpression,
  createSubmissionHeatmapControl,
  hasSubmissionHeatmapData,
} from "@/lib/map/heatmap.js";
import {
  createArchivedMapControl,
  hasArchivedMapData,
} from "@/lib/map/archivedMapEffect.js";
import {
  buildGoogleRoadmapTileUrl,
  getGoogleRoadmapSession,
  hasGoogleMapTilesApiKey,
} from "@/services/googleMapTilesApi.js";
import "maplibre-gl/dist/maplibre-gl.css";
import { getTotalComments } from "@/services/commentsApi";

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>`;

const EXIT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M9 20H4v-5"/><path d="M15 20h5v-5"/></svg>`;

const BOUNDARY_ON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16"/><path d="M4 12h16"/></svg>`;

const BOUNDARY_OFF_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m6 6 12 12"/></svg>`;

const MAP_BOUNDARY_COLOR = "#243b6b";
const TRANSPARENT_BOUNDARY_COLOR = "rgba(36, 59, 107, 0)";
const FED_OUTLINE_HIDE_AT_ZOOM = 7;
const EMPTY_OBJECTION_BOUNDARY = emptyBoundaryFeatureCollection();
const EMPTY_COUNTER_PROPOSAL_FEATURES = emptyCounterProposalFeatureCollection();
const CANADA_VIEW_BOUNDS = [CANADA_BOUNDS.sw, CANADA_BOUNDS.ne];
const CANADA_DEFAULT_VIEW_BOUNDS = [
  CANADA_BOUNDS.sw,
  [CANADA_BOUNDS.ne[0], 73],
];

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

function getGeoJsonBounds(geoJson) {
  const bounds = new maplibregl.LngLatBounds();

  function extendCoordinates(coordinates) {
    if (!Array.isArray(coordinates)) return;
    if (
      coordinates.length >= 2 &&
      Number.isFinite(Number(coordinates[0])) &&
      Number.isFinite(Number(coordinates[1]))
    ) {
      bounds.extend([Number(coordinates[0]), Number(coordinates[1])]);
      return;
    }
    coordinates.forEach(extendCoordinates);
  }

  const features = geoJson?.type === "FeatureCollection"
    ? geoJson.features
    : geoJson?.type === "Feature"
      ? [geoJson]
      : [];
  features?.forEach((feature) => extendCoordinates(feature?.geometry?.coordinates));
  return bounds.isEmpty() ? null : bounds;
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

function boundaryHighlightStateExpression() {
  return [
    "any",
    ["boolean", ["feature-state", "selected"], false],
    ["boolean", ["feature-state", "hover"], false],
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
    "fill-outline-color": TRANSPARENT_BOUNDARY_COLOR,
    "fill-opacity": fillOpacity,
    "fill-antialias": true
  };
}

function fedOutlinePaint(showBoundaries = true) {
  const defaultOpacity = boundaryLineOpacity(showBoundaries);

  return {
    "line-color": MAP_BOUNDARY_COLOR,
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.9,
      4,
      1.35,
      8,
      1.95,
      12,
      2.55,
    ],
    // MapLibre permits `zoom` only as the input of a top-level step/interpolate
    // expression. Before the DA-detail threshold, use the normal opacity; at
    // and above it, suppress only Enabled FED outlines.
    "line-opacity": [
      "step",
      ["zoom"],
      defaultOpacity,
      FED_OUTLINE_HIDE_AT_ZOOM,
      buildRolloutFedMembershipExpression(ENABLED_FED_NUMS, 0, defaultOpacity),
    ]
  };
}

function daFillPaint(
  showRollout,
  rolloutCategoryId = null,
  blinkHidden = false,
  showBoundaries = true,
  heatmapEnabled = false,
  heatmapFillExpression = null,
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
        heatmapFillExpression ?? "#ffffff",
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
    "fill-opacity": [
      "case",
      ["boolean", ["feature-state", "overridden"], false],
      0,
      fillOpacity,
    ],
    "fill-outline-color": TRANSPARENT_BOUNDARY_COLOR,
    "fill-antialias": true,
  };
}

function daOutlinePaint(minZoom = DEFAULT_DA_RENDER_MIN_ZOOM, showBoundaries = true) {
  return {
    "line-color": [
      "case",
      ["boolean", ["feature-state", "archived"], false],
      "#078f70",
      MAP_BOUNDARY_COLOR,
    ],
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      minZoom,
      ["case", ["boolean", ["feature-state", "archived"], false], 2.1, 0.9],
      minZoom + 5,
      ["case", ["boolean", ["feature-state", "archived"], false], 3.4, 1.3],
      minZoom + 10,
      ["case", ["boolean", ["feature-state", "archived"], false], 4.8, 1.75],
    ],
    "line-opacity": [
      "case",
      ["boolean", ["feature-state", "overridden"], false],
      0,
      boundaryLineOpacity(showBoundaries),
    ],
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

function buildWorkflowFocusExclusionFilter(dguids) {
  if (!dguids.size) {
    return null;
  }

  return [
    "!",
    [
      "in",
      ["to-string", ["get", "DGUID"]],
      ["literal", Array.from(dguids)],
    ],
  ];
}

export function MapCanvas({
  isFullscreen = false,
  mapSearchTarget = null,
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
  rolloutCategoryId = null,
  heatmap = null,
  archivedMap = null,
  initialArchivedMapEnabled = false,
  interactionMode = MAP_INTERACTION_MODE.BROWSE,
  workflowFocusDguids = [],
  focusGeoJson = null,
  focusMaxZoom = 15,
}) {
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [archivedMapEnabled, setArchivedMapEnabled] = useState(initialArchivedMapEnabled);
  const heatmapEnabledRef = useRef(false);
  const heatmapButtonRef = useRef(null);
  const heatmapControlRef = useRef(null);
  const heatmapFillExpressionRef = useRef(null);
  const archivedMapEnabledRef = useRef(initialArchivedMapEnabled);
  const archivedMapButtonRef = useRef(null);
  const archivedMapControlRef = useRef(null);
  const archivedDaIdsRef = useRef(new Set());
  const archivedOverrideDaIdsRef = useRef(new Set());
  const interactionModeRef = useRef(interactionMode);
  const overriddenDaIdsRef = useRef(new Set());
  const workflowFocusActiveRef = useRef(false);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const searchMarkerRef = useRef(null);
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
  const daRenderMinZoomRef = useRef(DEFAULT_DA_RENDER_MIN_ZOOM);
  const setFedStateRef = useRef(null);
  const applyPresentationModeRef = useRef(null);
  const applyBoundaryVisibilityRef = useRef(null);
  const applyHeatmapModeRef = useRef(null);
  const applyArchivedMapRef = useRef(null);
  const applySelectionRef = useRef(null);
  const applyExternalHoverRef = useRef(null);
  const applyObjectionPreviewRef = useRef(null);
  const applyCounterProposalPreviewRef = useRef(null);
  const applyWorkflowFocusRef = useRef(null);
  const applyInteractionModeRef = useRef(null);
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
  const [totalSubmissions, setTotalSubmissions] = useState(0);
  const totalSubmissionsRef = useRef(0);

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
  archivedMapEnabledRef.current = archivedMapEnabled;
  heatmapFillExpressionRef.current = hasSubmissionHeatmapData(heatmap)
    ? buildSubmissionHeatmapFillExpression(heatmap.countsByDguid, totalSubmissionsRef.current)
    : null;
  interactionModeRef.current = interactionMode;

  useEffect(() => {
    async function fetchTotalSubmissions() {
      try {
        const data = await getTotalComments();

        setTotalSubmissions(data.totalSubmissions);
        totalSubmissionsRef.current = data.totalSubmissions;
      } catch (error) {
        console.error("Failed to fetch total submissions:", error);
      }
    }

    fetchTotalSubmissions();
  }, [heatmap, totalSubmissions]);

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
    const button = archivedMapButtonRef.current;
    if (!button) return;
    button.classList.toggle("active", archivedMapEnabled);
    button.setAttribute("aria-pressed", String(archivedMapEnabled));
  }, [archivedMapEnabled]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !isMapReadyRef.current) {
      return;
    }

    const heatmapAvailable = hasSubmissionHeatmapData(heatmap);

    if (heatmapAvailable && !heatmapControlRef.current) {
      const control = createSubmissionHeatmapControl(
        heatmapButtonRef,
        () => heatmapEnabledRef.current,
        () => setHeatmapEnabled((current) => {
          const next = !current;
          if (next) setArchivedMapEnabled(false);
          return next;
        }),
      );

      map.addControl(control, "top-right");
      heatmapControlRef.current = control;
      return;
    }

    if (!heatmapAvailable && heatmapControlRef.current) {
      map.removeControl(heatmapControlRef.current);
      heatmapControlRef.current = null;
      heatmapButtonRef.current = null;
    }
  }, [heatmap, mapReadyTick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReadyRef.current) return;
    const available = hasArchivedMapData(archivedMap);

    if (available && !archivedMapControlRef.current) {
      const control = createArchivedMapControl(
        archivedMapButtonRef,
        () => archivedMapEnabledRef.current,
        () => setArchivedMapEnabled((current) => {
          const next = !current;
          if (next) setHeatmapEnabled(false);
          return next;
        }),
      );
      map.addControl(control, "top-right");
      archivedMapControlRef.current = control;
      return;
    }

    if (!available && archivedMapControlRef.current) {
      map.removeControl(archivedMapControlRef.current);
      archivedMapControlRef.current = null;
      archivedMapButtonRef.current = null;
      setArchivedMapEnabled(false);
    }
  }, [archivedMap, mapReadyTick]);

  useEffect(() => {
    if (!hasSubmissionHeatmapData(heatmap) && heatmapEnabled) {
      setHeatmapEnabled(false);
    }
  }, [heatmap, heatmapEnabled]);

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
    const map = mapRef.current;
    const coordinates = mapSearchTarget?.location;

    if (
      !map
      || !isMapReadyRef.current
      || !Array.isArray(coordinates)
      || coordinates.length < 2
      || !coordinates.every(Number.isFinite)
    ) {
      return;
    }

    const viewport = mapSearchTarget?.viewport;

    if (
      Array.isArray(viewport)
      && viewport.length === 2
      && viewport.every((corner) =>
        Array.isArray(corner)
        && corner.length >= 2
        && corner.every(Number.isFinite))
    ) {
      map.fitBounds(viewport, {
        padding: 72,
        maxZoom: 15,
        duration: 700,
      });
    } else {
      map.flyTo({
        center: coordinates,
        zoom: Math.max(map.getZoom(), 14),
        duration: 700,
      });
    }

    if (!searchMarkerRef.current) {
      searchMarkerRef.current = new maplibregl.Marker({
        color: "#1a73e8",
      });
    }

    searchMarkerRef.current
      .setLngLat(coordinates)
      .addTo(map);
    onStatusChangeRef.current?.(`Map moved to ${mapSearchTarget.label || "the selected place"}.`);
  }, [mapReadyTick, mapSearchTarget]);

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
    if (!isMapReadyRef.current || !applyWorkflowFocusRef.current) {
      return;
    }

    applyWorkflowFocusRef.current(workflowFocusDguids);
  }, [mapReadyTick, workflowFocusDguids]);

  useEffect(() => {
    if (isMapReadyRef.current && applyInteractionModeRef.current) {
      applyInteractionModeRef.current(interactionMode);
    }
  }, [interactionMode, mapReadyTick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReadyRef.current || !focusGeoJson) return;
    const bounds = getGeoJsonBounds(focusGeoJson);
    if (!bounds) return;

    map.fitBounds(bounds, {
      padding: 34,
      maxZoom: Math.min(MAP_ZOOM.MAX, focusMaxZoom),
      duration: 700,
    });
  }, [focusGeoJson, focusMaxZoom, mapReadyTick]);

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
  }, [heatmap, heatmapEnabled, mapReadyTick]);

  useEffect(() => {
    if (!isMapReadyRef.current || !applyArchivedMapRef.current) return;
    applyArchivedMapRef.current(archivedMap, archivedMapEnabled);
  }, [archivedMap, archivedMapEnabled, mapReadyTick]);

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
            heatmapFillExpressionRef.current,
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
            heatmapFillExpressionRef.current,
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
            heatmapFillExpressionRef.current,
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
            heatmapFillExpressionRef.current,
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
      bounds: CANADA_DEFAULT_VIEW_BOUNDS,
      fitBoundsOptions: { padding: 12 },
      minZoom: MAP_ZOOM.MIN,
      maxZoom: MAP_ZOOM.MAX,
      maxBounds: CANADA_VIEW_BOUNDS,
      renderWorldCopies: false,
      maxPitch: 0,
      attributionControl: false,
    });

    mapRef.current = map;
    // A MapLibre feature-state belongs to a particular map/source instance.
    // Start fresh if this component creates a replacement map instance.
    overriddenDaIdsRef.current = new Set();
    workflowFocusActiveRef.current = false;
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

    function setWorkflowFocusLayerFilter(focusDguids) {
      if (map.getLayer("da-fill")) {
        map.setFilter("da-fill", buildWorkflowFocusExclusionFilter(focusDguids));
      }

      // A polygon line layer cannot suppress only one side of a shared edge:
      // an unselected neighbour will redraw it. While a pair is focused the
      // whole baseline DA outline layer is hidden and exact GeoJSON boundary
      // segments take over, so any stale PMTiles line is impossible to show.
      if (map.getLayer("da-outline")) {
        map.setFilter("da-outline", null);
      }
    }

    function applyWorkflowFocus(dguids) {
      const nextIds = new Set((dguids ?? []).map(String));
      const previousIds = overriddenDaIdsRef.current;

      previousIds.forEach((id) => {
        if (!nextIds.has(id)) {
          setDaFeatureState(id, { overridden: false });
        }
      });

      nextIds.forEach((id) => {
        if (!previousIds.has(id)) {
          setDaFeatureState(id, { overridden: true });
        }
      });

      workflowFocusActiveRef.current = nextIds.size > 0;
      setWorkflowFocusLayerFilter(nextIds);

      if (map.getLayer("da-outline")) {
        map.setLayoutProperty(
          "da-outline",
          "visibility",
          workflowFocusActiveRef.current ? "none" : "visible",
        );
      }

      overriddenDaIdsRef.current = nextIds;
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
          heatmapFillExpressionRef.current,
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
      daRenderMinZoomRef.current = minZoom;

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
            heatmapFillExpressionRef.current,
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
            heatmapFillExpressionRef.current,
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
            heatmapFillExpressionRef.current,
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
        heatmapFillExpressionRef.current,
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
          TRANSPARENT_BOUNDARY_COLOR,
        );
      }

      if (map.getLayer("da-fill")) {
        map.setPaintProperty(
          "da-fill",
          "fill-outline-color",
          TRANSPARENT_BOUNDARY_COLOR,
        );
      }

      if (map.getLayer("fed-outline")) {
        map.setLayoutProperty("fed-outline", "visibility", "visible");
        map.setPaintProperty(
          "fed-outline",
          "line-opacity",
          fedOutlinePaint(showBoundaries)["line-opacity"],
        );
      }

      if (map.getLayer("da-outline")) {
        map.setLayoutProperty(
          "da-outline",
          "visibility",
          workflowFocusActiveRef.current ? "none" : "visible",
        );
        map.setPaintProperty("da-outline", "line-opacity", boundaryLineOpacity(showBoundaries));
      }
    }

    function addObjectionBoundaryLayers() {
      map.addSource("workflow-focus", {
        type: "geojson",
        data: EMPTY_COUNTER_PROPOSAL_FEATURES,
      });

      map.addLayer({
        id: "workflow-focus-fill",
        type: "fill",
        source: "workflow-focus",
        paint: {
          "fill-color": "#7aa8f8",
          "fill-opacity": 0.58,
          "fill-outline-color": TRANSPARENT_BOUNDARY_COLOR,
        },
      });

      map.addSource("workflow-focus-outer-boundary", {
        type: "geojson",
        data: EMPTY_OBJECTION_BOUNDARY,
      });

      map.addLayer({
        id: "workflow-focus-outline",
        type: "line",
        source: "workflow-focus-outer-boundary",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": MAP_BOUNDARY_COLOR,
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.6, 8, 2.8, 11, 3.9],
          "line-opacity": 1,
        },
      });

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
            7.5,
            8,
            14
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
            3,
            8,
            5.4
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
          "fill-outline-color": TRANSPARENT_BOUNDARY_COLOR,
        },
      });

      map.addSource("counter-proposal-outer-boundary", {
        type: "geojson",
        data: EMPTY_OBJECTION_BOUNDARY,
      });

      map.addLayer({
        id: "counter-proposal-outline",
        type: "line",
        source: "counter-proposal-outer-boundary",
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
            1.6,
            8,
            2.8,
            11,
            3.9,
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
            9.5,
            8,
            16,
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
            3.5,
            8,
            6.2,
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

    function addArchivedMapLayers() {
      map.addSource("archived-map-overrides", {
        type: "geojson",
        data: EMPTY_COUNTER_PROPOSAL_FEATURES,
        promoteId: "DGUID",
      });
      map.addLayer({
        id: "archived-map-fill",
        type: "fill",
        source: "archived-map-overrides",
        layout: { visibility: "none" },
        paint: {
          "fill-color": "#6fd7b5",
          "fill-opacity": 0.42,
          "fill-outline-color": TRANSPARENT_BOUNDARY_COLOR,
        },
      });
      map.addLayer({
        id: "archived-map-outline",
        type: "line",
        source: "archived-map-overrides",
        layout: {
          visibility: "none",
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#078f70",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.4, 8, 4.2, 12, 6.2],
          "line-opacity": 1,
        },
      });
    }

    function syncDaOutlineVisibility() {
      if (map.getLayer("da-outline")) {
        map.setLayoutProperty(
          "da-outline",
          "visibility",
          workflowFocusActiveRef.current ? "none" : "visible",
        );
      }
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

    function pickMapTarget(point) {
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

      if (isMapFeatureInteractionLocked(interactionModeRef.current)) {
        return null;
      }

      const daFeatures = map.getLayer("da-fill")
        ? map.queryRenderedFeatures(point, { layers: ["da-fill"] })
        : [];
      if (daFeatures.length) {
        const feature = daFeatures[0];
        const id = getFeatureId(feature, "DGUID");
        const fedNum = feature.properties?.fed_num ?? feature.properties?.FED_NUM;
        if (id && canInteractWithDa(fedNum, interactionModeRef.current)) {
          return { type: "da", id };
        }
      }

      const fedFeatures = map.getLayer("fed-fill")
        ? map.queryRenderedFeatures(point, { layers: ["fed-fill"] })
        : [];
      if (fedFeatures.length) {
        const feature = fedFeatures[0];
        const id = getFeatureId(feature, "fed_num");
        if (id && canInteractWithFed(id, interactionModeRef.current)) {
          return { type: "fed", id };
        }
        if (id && isDataBlockedFed(id)) {
          return { type: "data-blocked", id };
        }
        if (
          id
          && isEnabledFed(id)
          && map.getZoom() < daRenderMinZoomRef.current
        ) {
          return { type: "zoom-required", id };
        }
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
      const focusSource = map.getSource("workflow-focus");
      const outerBoundarySource = map.getSource("workflow-focus-outer-boundary");

      if (!source || typeof source.setData !== "function") {
        return;
      }

      source.setData(nextPreview?.boundaryGeoJson ?? EMPTY_OBJECTION_BOUNDARY);
      if (focusSource && typeof focusSource.setData === "function") {
        focusSource.setData(nextPreview?.featureCollection ?? EMPTY_COUNTER_PROPOSAL_FEATURES);
      }
      if (outerBoundarySource && typeof outerBoundarySource.setData === "function") {
        outerBoundarySource.setData(
          nextPreview?.outerBoundaryGeoJson ?? EMPTY_OBJECTION_BOUNDARY,
        );
      }
    }

    function applyCounterProposalPreview(nextPreview) {
      const proposalSource = map.getSource("counter-proposal");
      const boundarySource = map.getSource("counter-proposal-boundary");
      const outerBoundarySource = map.getSource("counter-proposal-outer-boundary");
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

      if (outerBoundarySource && typeof outerBoundarySource.setData === "function") {
        outerBoundarySource.setData(
          nextPreview?.outerBoundaryGeoJson ?? EMPTY_OBJECTION_BOUNDARY,
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

    function applyArchivedMap(nextData, enabled) {
      const nextArchivedIds = enabled
        ? new Set((nextData?.dguids ?? []).map(String))
        : new Set();
      const nextOverrideIds = enabled
        ? new Set((nextData?.overrideDguids ?? []).map(String))
        : new Set();

      archivedDaIdsRef.current.forEach((id) => {
        if (!nextArchivedIds.has(id)) setDaFeatureState(id, { archived: false });
      });
      nextArchivedIds.forEach((id) => {
        if (!archivedDaIdsRef.current.has(id)) setDaFeatureState(id, { archived: true });
      });
      archivedOverrideDaIdsRef.current.forEach((id) => {
        if (!nextOverrideIds.has(id) && !overriddenDaIdsRef.current.has(id)) {
          setDaFeatureState(id, { overridden: false });
        }
      });
      nextOverrideIds.forEach((id) => {
        if (!archivedOverrideDaIdsRef.current.has(id)) setDaFeatureState(id, { overridden: true });
      });

      archivedDaIdsRef.current = nextArchivedIds;
      archivedOverrideDaIdsRef.current = nextOverrideIds;
      const source = map.getSource("archived-map-overrides");
      if (source && typeof source.setData === "function") {
        source.setData(enabled
          ? nextData?.featureCollection ?? EMPTY_COUNTER_PROPOSAL_FEATURES
          : EMPTY_COUNTER_PROPOSAL_FEATURES);
      }
      ["archived-map-fill", "archived-map-outline"].forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", enabled ? "visible" : "none");
        }
      });
    }

    function applyInteractionMode(mode) {
      if (isMapFeatureInteractionLocked(mode)) {
        setInternalHover(null);
        map.getCanvas().style.cursor = "";
      }
    }

    applySelectionRef.current = applySelectionTarget;
    applyExternalHoverRef.current = setExternalHover;
    applyObjectionPreviewRef.current = applyObjectionPreview;
    applyCounterProposalPreviewRef.current = applyCounterProposalPreview;
    applyWorkflowFocusRef.current = applyWorkflowFocus;
    applyInteractionModeRef.current = applyInteractionMode;
    applyPresentationModeRef.current = setPresentationMode;
    applyBoundaryVisibilityRef.current = applyBoundaryVisibility;
    applyHeatmapModeRef.current = setHeatmapMode;
    applyArchivedMapRef.current = applyArchivedMap;

    const onClick = (event) => {
      if (skipNextClickRef.current) {
        skipNextClickRef.current = false;
        return;
      }

      const hit = pickMapTarget(event.point);

      if (hit?.type === "counter-proposal-handle") {
        onCounterProposalHandleSelectRef.current?.(hit.id);
        return;
      }

      if (!hit || hit.type === "data-blocked" || hit.type === "zoom-required") {
        return;
      }

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

      const hit = pickMapTarget(event.point);

      if (hit?.type === "counter-proposal-handle") {
        map.getCanvas().style.cursor = "grab";
        setInternalHover(null);
        return;
      }

      if (hit?.type === "zoom-required") {
        map.getCanvas().style.cursor = "zoom-in";
        setInternalHover(null);
        return;
      }

      if (hit?.type === "data-blocked" || hit?.type === "fed") {
        map.getCanvas().style.cursor = "not-allowed";
        setInternalHover(hit.type === "fed" ? hit : null);
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
      const hit = pickMapTarget(event.point);

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
        addArchivedMapLayers();
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
        applyWorkflowFocus(workflowFocusDguids);
        applyInteractionMode(interactionModeRef.current);
        setPresentationMode(rolloutEnabled);
        applyBoundaryVisibility(boundariesVisibleRef.current);

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
      applyArchivedMapRef.current = null;
      heatmapControlRef.current = null;
      heatmapButtonRef.current = null;
      archivedMapControlRef.current = null;
      archivedMapButtonRef.current = null;
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      archivedDaIdsRef.current = new Set();
      archivedOverrideDaIdsRef.current = new Set();
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
