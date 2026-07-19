import rolloutPlan from "@/data/map/manifests/fed_rollout_plan.json";
import daAssetManifest from "@/data/map/manifests/da_asset_manifest.json";
import { normalizeDaAssetManifest } from "./daAssetManifest.js";

export const DEFAULT_ROLLOUT_CATEGORY_ID = "enabled";

export const ROLLOUT_CATEGORIES = [
  {
    id: "enabled",
    label: "Enabled",
    color: "#1a73e8",
    accentColor: "#e8f0fe",
    description: "Local DA geometry and local labels are available in this mode.",
  },
  {
    id: "data-blocked",
    label: "Data Blocked",
    color: "#f6efdf",
    accentColor: "#f6efdf",
    description: "FED geometry is available, but DA metadata is not ready yet.",
  },
];

const categoryById = new Map(ROLLOUT_CATEGORIES.map((category) => [category.id, category]));

const enabledFedNums = new Set(
  normalizeDaAssetManifest(daAssetManifest).assets
    .filter((asset) => asset.renderIncluded && asset.metadataGeojsons.length)
    .map((asset) => String(asset.fedNum)),
);

const allAreas = Array.isArray(rolloutPlan?.areas)
  ? rolloutPlan.areas.map((area) => ({
      ...area,
      categoryId: enabledFedNums.has(String(area.fedNum)) ? "enabled" : "data-blocked",
    }))
  : [];

export function getRolloutCategory(categoryId = DEFAULT_ROLLOUT_CATEGORY_ID) {
  return categoryById.get(categoryId) ?? categoryById.get(DEFAULT_ROLLOUT_CATEGORY_ID);
}

export function getRolloutAreas(categoryId) {
  return allAreas.filter((area) => area.categoryId === categoryId);
}

export function getAllRolloutAreas() {
  return allAreas;
}

export function getRolloutArea(fedNum) {
  return allAreas.find((area) => area.fedNum === String(fedNum)) ?? null;
}

export function isEnabledFed(fedNum) {
  return getRolloutArea(fedNum)?.categoryId === "enabled";
}

export function isDataBlockedFed(fedNum) {
  return getRolloutArea(fedNum)?.categoryId === "data-blocked";
}

export function getRolloutColor(categoryId) {
  return getRolloutCategory(categoryId).color;
}

export function getRolloutAccentColor(categoryId) {
  return getRolloutCategory(categoryId).accentColor;
}
