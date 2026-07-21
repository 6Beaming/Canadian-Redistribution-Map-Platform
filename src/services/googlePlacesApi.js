import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

const GOOGLE_MAPS_API_KEY = String(
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "",
).trim();
const GOOGLE_MAPS_LANGUAGE = String(
  import.meta.env.VITE_GOOGLE_MAP_TILES_LANGUAGE ??
    (typeof navigator !== "undefined" ? navigator.language : "en-CA"),
).trim();
const GOOGLE_MAPS_REGION = String(
  import.meta.env.VITE_GOOGLE_MAP_TILES_REGION ?? "CA",
).trim();

let placesLibraryPromise = null;
let loaderConfigured = false;

export function hasGooglePlacesApiKey() {
  return Boolean(GOOGLE_MAPS_API_KEY);
}

export function loadGooglePlacesLibrary() {
  if (!hasGooglePlacesApiKey()) {
    return Promise.reject(new Error("Missing VITE_GOOGLE_MAPS_API_KEY."));
  }

  if (!loaderConfigured) {
    setOptions({
      key: GOOGLE_MAPS_API_KEY,
      v: "weekly",
      language: GOOGLE_MAPS_LANGUAGE || "en-CA",
      region: GOOGLE_MAPS_REGION || "CA",
    });
    loaderConfigured = true;
  }

  if (!placesLibraryPromise) {
    placesLibraryPromise = importLibrary("places").catch((error) => {
      placesLibraryPromise = null;
      throw error;
    });
  }

  return placesLibraryPromise;
}
