import fs from "fs";
import path from "path";
import { Router } from "express";
import { getMapDataRoot } from "./paths.js";

const router = Router();
const MISSING_NAME = "missing name";

function resolveProfilesPath() {
  const dataRoot = getMapDataRoot();
  const candidates = [
    path.join(dataRoot, "indexes", "da_profile_index.json"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

function mergeProfile(primary, fallback) {
  if (!primary) return fallback ?? null;
  if (!fallback) return primary;

  const merged = { ...primary };
  const fieldsToFill = [
    "population",
    "source",
    "name_source",
    "community_name",
    "community_source",
    "community_display",
    "is_unorganized",
    "panel_title",
    "display_label",
    "map_label",
  ];

  fieldsToFill.forEach((field) => {
    if ((isBlank(merged[field]) || merged[field] === false) && !isBlank(fallback[field])) {
      merged[field] = fallback[field];
    }
  });

  if ((isBlank(merged.geo_name) || merged.geo_name === MISSING_NAME) && !isBlank(fallback.geo_name)) {
    merged.geo_name = fallback.geo_name;
  }

  if ((!merged.population && merged.population !== 0) && (fallback.population || fallback.population === 0)) {
    merged.population = fallback.population;
  }

  return merged;
}

router.get("/da-profiles", (_req, res, next) => {
  try {
    const dataRoot = getMapDataRoot();
    const primaryPath = resolveProfilesPath();
    const primaryPayload = readJsonIfExists(primaryPath) ?? { profiles: {} };

    const payload = {
      ...primaryPayload,
      profiles: primaryPayload.profiles ?? {},
    };

    res.type("application/json").send(JSON.stringify(payload));
  } catch (error) {
    next(error);
  }
});

export default router;
