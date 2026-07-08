import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getMapDataRoot() {
  return path.join(__dirname, "..", "..", "src", "data", "map");
}

export function getAssignmentsStorePath() {
  return path.join(__dirname, "store", "assignments.json");
}

export const ALLOWED_ASSET_EXTENSIONS = new Set([
  ".geojson",
  ".json",
  ".pmtiles"
]);
