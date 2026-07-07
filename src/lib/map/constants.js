export const MVP_FED_NUM = "60001";
export const FED_COUNT = 343;
export const FED_SOURCE_LAYER = "fed2023_districts";

export const SELECTED_COLOR = "#006064";
export const HOVER_COLOR = "#00e5ff";

export const OUTLINE_ZOOM = {
  DA_MIN: 9
};

export const LABEL_ZOOM = {
  FED_MIN: 3,
  FED_NATIONAL_MAX: 9,
  FED_LOCAL_MIN: 9,
  DA_COMMUNITY_MIN: 6,
  DA_CODE_MIN: 10
};

export const LABEL_FONT = ["Open Sans Regular", "Arial Unicode MS Regular"];

export const MISSING_DA_NAME = "missing name";
export const MISSING_DA_POPULATION = "missing population";

export const CANADA_BOUNDS = {
  sw: [-141.5, 41.0],
  ne: [-52.0, 83.9]
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
