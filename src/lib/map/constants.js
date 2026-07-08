export const MVP_FED_NUM = "60001";
export const FED_COUNT = 343;
export const FED_SOURCE_LAYER = "fed2023_districts";
export const DEFAULT_DA_SOURCE_LAYER = "da_boundaries_available";
export const DEFAULT_DA_RENDER_MIN_ZOOM = 5;
export const DEFAULT_DA_RENDER_MAX_ZOOM = 12;

export const SELECTED_COLOR = "#e8a0a0";
export const HOVER_COLOR = "#f4d03f";
export const ENABLED_FILL_COLOR = "#1a73e8";
export const DATA_BLOCKED_FILL_COLOR = "#f6efdf";
export const TRANSPARENT_INTERACTION_OPACITY = 0.001;

export const LABEL_ZOOM = {
  FED_MIN: 3,
  FED_NATIONAL_MAX: 9,
  FED_LOCAL_MIN: 9,
  DA_COMMUNITY_MIN: 5,
  DA_CODE_MIN: 9
};

export const LABEL_FONT = ["Open Sans Regular", "Arial Unicode MS Regular"];

export const MISSING_DA_NAME = "missing name";
export const MISSING_DA_POPULATION = "missing population";

export const CANADA_BOUNDS = {
  sw: [-141.8, 41.0],
  ne: [-52.0, 83.6]
};

export const MAP_ZOOM = {
  INITIAL: 4.4,
  MIN: 0,
  MAX: 16
};

export const WHITE_BASEMAP_STYLE = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#ffffff" }
    }
  ]
};
