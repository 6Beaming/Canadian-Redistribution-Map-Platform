import { isDataBlockedFed, isEnabledFed } from "./rolloutPlan.js";

export const MAP_INTERACTION_MODE = Object.freeze({
  BROWSE: "browse",
  PAIR_SELECT: "pair-select",
  OBJECTION_FOCUS: "objection-focus",
  COUNTER_EDIT: "counter-edit",
  COUNTER_REVIEW: "counter-review",
  SUBMISSION_READONLY: "submission-readonly",
});

export function isMapFeatureInteractionLocked(mode) {
  return [
    MAP_INTERACTION_MODE.OBJECTION_FOCUS,
    MAP_INTERACTION_MODE.COUNTER_EDIT,
    MAP_INTERACTION_MODE.COUNTER_REVIEW,
    MAP_INTERACTION_MODE.SUBMISSION_READONLY,
  ].includes(mode);
}

export function canInteractWithDa(fedNum, mode = MAP_INTERACTION_MODE.BROWSE) {
  return !isMapFeatureInteractionLocked(mode) && isEnabledFed(fedNum);
}

export function canInteractWithFed(fedNum, mode = MAP_INTERACTION_MODE.BROWSE) {
  return mode === MAP_INTERACTION_MODE.BROWSE && isDataBlockedFed(fedNum);
}
