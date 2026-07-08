import { LABEL_FONT } from "./constants.js";

export const FED_LABEL_ZOOM = {
  NATIONAL_MIN: 3,
  NATIONAL_MAX: 9,
  LOCAL_MIN: 9,
  LOCAL_MAX: 16
};

export const DA_LABEL_ZOOM = {
  COMMUNITY_MIN: 5,
  CODE_MIN: 9,
  MAX: 16
};

const FED_NATIONAL_SIZE_PAIRS = [
  [3, 12],
  [4, 13],
  [5, 15],
  [6, 17],
  [7, 19],
  [8, 20]
];

const FED_LOCAL_SIZE_PAIRS = [
  [9, 11],
  [10, 11],
  [11, 10],
  [12, 10],
  [13, 10],
  [14, 10]
];

const DA_COMMUNITY_SIZE_PAIRS = [
  [5, 9],
  [6, 10],
  [7, 11],
  [8, 13],
  [9, 14],
  [10, 15],
  [11, 16],
  [12, 18],
  [13, 20],
  [14, 22]
];

const DA_CODE_SIZE_PAIRS = [
  [9, 8],
  [10, 9],
  [11, 10],
  [12, 11],
  [13, 12],
  [14, 13]
];

export function labelScreenScale(containerWidth) {
  if (!containerWidth || containerWidth <= 0) return 1;
  return Math.min(1.7, Math.max(0.95, containerWidth / 680));
}

export function buildZoomTextSize(pairs, scale, curve = 1.35) {
  const expression = ["interpolate", ["exponential", curve], ["zoom"]];
  pairs.forEach(([zoom, size]) => {
    expression.push(zoom, Math.round(size * scale * 10) / 10);
  });
  return expression;
}

export function fedNationalLabelLayout(scale = 1) {
  return {
    "text-field": ["get", "name"],
    "text-size": buildZoomTextSize(FED_NATIONAL_SIZE_PAIRS, scale, 1.35),
    "text-anchor": "center",
    "text-allow-overlap": false,
    "text-ignore-placement": false,
    "text-optional": true,
    "text-padding": 4,
    "text-max-width": 9,
    "text-font": LABEL_FONT
  };
}

export function fedLocalLabelLayout(scale = 1) {
  return {
    "text-field": ["get", "name"],
    "text-size": buildZoomTextSize(FED_LOCAL_SIZE_PAIRS, scale, 1.2),
    "text-anchor": "center",
    "text-allow-overlap": false,
    "text-ignore-placement": false,
    "text-optional": true,
    "text-padding": 2,
    "text-max-width": 7,
    "text-font": LABEL_FONT
  };
}

export function daCommunityLabelLayout(scale = 1) {
  return {
    "text-field": ["get", "name"],
    "text-size": buildZoomTextSize(DA_COMMUNITY_SIZE_PAIRS, scale, 1.3),
    "text-anchor": "center",
    "text-allow-overlap": ["step", ["zoom"], false, 11, true],
    "text-ignore-placement": ["step", ["zoom"], false, 11, true],
    "text-optional": ["step", ["zoom"], true, 11, false],
    "text-padding": 3,
    "text-max-width": 8,
    "symbol-sort-key": ["get", "priority"],
    "text-font": LABEL_FONT
  };
}

export function daCodeLabelLayout(scale = 1) {
  return {
    "text-field": ["get", "name"],
    "text-size": buildZoomTextSize(DA_CODE_SIZE_PAIRS, scale, 1.2),
    "text-anchor": "center",
    "text-allow-overlap": ["step", ["zoom"], false, 12, true],
    "text-ignore-placement": ["step", ["zoom"], false, 12, true],
    "text-optional": true,
    "text-padding": 1,
    "text-max-width": 6,
    "symbol-sort-key": ["get", "priority"],
    "text-font": LABEL_FONT
  };
}

export function fedNationalLabelPaint() {
  return {
    "text-color": "#1e3a5f",
    "text-halo-color": "#ffffff",
    "text-halo-width": 2,
    "text-halo-blur": 0.25,
    "text-opacity": ["interpolate", ["linear"], ["zoom"], 6, 1, 7.5, 0.35, 8.5, 0]
  };
}

export function fedLocalLabelPaint() {
  return {
    "text-color": "#2c3e50",
    "text-halo-color": "#ffffff",
    "text-halo-width": 1.75,
    "text-halo-blur": 0.2,
    "text-opacity": 0.9
  };
}

export function daCommunityLabelPaint() {
  return {
    "text-color": "#0d2137",
    "text-halo-color": "#ffffff",
    "text-halo-width": 2,
    "text-halo-blur": 0.25,
    "text-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.42, 6.5, 0.72, 8, 1, 14, 1]
  };
}

export function daCodeLabelPaint() {
  return {
    "text-color": "#34495e",
    "text-halo-color": "#ffffff",
    "text-halo-width": 1.5,
    "text-halo-blur": 0.2,
    "text-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.58, 10, 0.8, 12, 0.92, 14, 0.92]
  };
}

export function applyLabelScale(map, scale) {
  if (!map?.getStyle()) return;

  const updates = [
    ["fed-labels-national", FED_NATIONAL_SIZE_PAIRS, 1.35],
    ["fed-labels-local", FED_LOCAL_SIZE_PAIRS, 1.2],
    ["da-labels-community", DA_COMMUNITY_SIZE_PAIRS, 1.3],
    ["da-labels-code", DA_CODE_SIZE_PAIRS, 1.2]
  ];

  updates.forEach(([layerId, pairs, curve]) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(
        layerId,
        "text-size",
        buildZoomTextSize(pairs, scale, curve)
      );
    }
  });
}
