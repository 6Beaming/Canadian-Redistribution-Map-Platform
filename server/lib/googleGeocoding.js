const GOOGLE_GEOCODING_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";
const MISSING_RESULT_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

let googleGeocodingTestDouble;

export function setGoogleGeocodingTestDouble(testDouble = null) {
  googleGeocodingTestDouble = testDouble;
}

export function isGoogleGeocodingConfigured() {
  return Boolean(
    googleGeocodingTestDouble || process.env.GOOGLE_MAPS_SERVER_API_KEY
  );
}

function normalizedPostalCode(value) {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}

function addressComponent(result, type) {
  return result?.address_components?.find((component) =>
    component.types?.includes(type)
  );
}

function matchesCanadianPostalCode(result, postalCode, province) {
  const resultPostalCode = normalizedPostalCode(
    addressComponent(result, "postal_code")?.long_name
  );
  const countryCode = String(
    addressComponent(result, "country")?.short_name ?? ""
  ).toUpperCase();
  const provinceCode = String(
    addressComponent(result, "administrative_area_level_1")?.short_name ?? ""
  ).toUpperCase();

  return (
    resultPostalCode === normalizedPostalCode(postalCode) &&
    countryCode === "CA" &&
    (!province || provinceCode === String(province).toUpperCase())
  );
}

export function getPostalMapCenter(profile) {
  if (
    profile?.postal_latitude === null ||
    profile?.postal_latitude === undefined ||
    profile?.postal_longitude === null ||
    profile?.postal_longitude === undefined
  ) {
    return null;
  }

  const latitude = Number(profile?.postal_latitude);
  const longitude = Number(profile?.postal_longitude);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

export function shouldRefreshPostalGeocode(
  profile,
  { postalCode = profile?.postal_code, province = profile?.province } = {}
) {
  if (!postalCode || !province) {
    return false;
  }

  if (
    normalizedPostalCode(profile?.postal_code) !==
      normalizedPostalCode(postalCode) ||
    String(profile?.province ?? "").toUpperCase() !==
      String(province).toUpperCase()
  ) {
    return true;
  }

  if (getPostalMapCenter(profile)) {
    return false;
  }

  const attemptedAt = Date.parse(profile?.postal_geocoded_at);

  return (
    !Number.isFinite(attemptedAt) ||
    Date.now() - attemptedAt >= MISSING_RESULT_RETRY_MS
  );
}

export async function geocodeCanadianPostalCode({ postalCode, province }) {
  if (googleGeocodingTestDouble) {
    return googleGeocodingTestDouble({ postalCode, province });
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;

  if (!apiKey) {
    return null;
  }

  const url = new URL(GOOGLE_GEOCODING_URL);
  url.searchParams.set(
    "components",
    `postal_code:${normalizedPostalCode(postalCode)}|administrative_area:${String(
      province
    ).toUpperCase()}|country:CA`
  );
  url.searchParams.set("region", "ca");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !["OK", "ZERO_RESULTS"].includes(payload.status)) {
    throw new Error(
      payload.error_message || "Google could not geocode the postal code."
    );
  }

  const result = payload.results?.find((candidate) =>
    matchesCanadianPostalCode(candidate, postalCode, province)
  );
  const latitude = Number(result?.geometry?.location?.lat);
  const longitude = Number(result?.geometry?.location?.lng);

  if (!result || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude
  };
}
