import rolloutPlan from "@/data/map/fed_rollout_plan.json";

export const DEFAULT_ROLLOUT_CATEGORY_ID = "effected";

export const ROLLOUT_CATEGORIES = [
  {
    id: "effected",
    label: "Effected",
    color: "#1a73e8",
    accentColor: "#e8f0fe",
    description: "Currently effective pilot coverage.",
  },
  {
    id: "data-blocked",
    label: "Data Blocked",
    color: "#b39af4",
    accentColor: "#f5f0ff",
    description: "FED geometry exists, but required DA inputs are blocked by missing bundle assets.",
  },
  {
    id: "developing",
    label: "Developing",
    color: "#2f8f4d",
    accentColor: "#e2f4e8",
    description: "Secondary FEDs selected for the next buildout wave.",
  },
  {
    id: "planned-in-developing",
    label: "Planned in Developing",
    color: "#f6efdf",
    accentColor: "#f6efdf",
    description: "Data-ready provinces queued behind the current development wave.",
  },
];

const categoryById = new Map(ROLLOUT_CATEGORIES.map((category) => [category.id, category]));
const allAreas = Array.isArray(rolloutPlan?.areas) ? rolloutPlan.areas : [];

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

export function getRolloutColor(categoryId) {
  return getRolloutCategory(categoryId).color;
}

export function getRolloutAccentColor(categoryId) {
  return getRolloutCategory(categoryId).accentColor;
}
