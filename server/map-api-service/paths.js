import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getMapDataRoot() {
  return path.join(__dirname, "..", "..", "src", "data", "map");
}

export function getAssignmentsStorePath() {
  return path.join(__dirname, "store", "assignments.json");
}

export const ALLOWED_ASSET_FILES = new Set([
  "single_fed_das.geojson",
  "fed_boundaries_2023.geojson",
  "fed_boundaries_2023.pmtiles",
  "fed_labels.geojson"
]);
