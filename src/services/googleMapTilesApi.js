const GOOGLE_TILE_BASE_URL = "https://tile.googleapis.com/v1";
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

const LABEL_HIDDEN_STYLES = [
  {
    featureType: "all",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "transit",
    stylers: [{ visibility: "off" }],
  },
];

const sessionCacheByMode = new Map();

function buildGoogleTilesErrorMessage(rawMessage, status) {
  const fallback = rawMessage || `Google Map Tiles session request failed (${status}).`;

  try {
    const payload = JSON.parse(rawMessage);
    const error = payload?.error ?? {};
    const details = Array.isArray(error.details) ? error.details : [];
    const errorInfo = details.find((detail) => detail?.reason);
    const localized = details.find((detail) => typeof detail?.message === "string");

    if (errorInfo?.reason === "API_KEY_HTTP_REFERRER_BLOCKED") {
      const referrer = errorInfo?.metadata?.httpReferrer || window.location.origin;
      return [
        `Google Map Tiles API blocked the current local origin: ${referrer}.`,
        "Allow `http://localhost:5173/*` and `http://127.0.0.1:5173/*` in the key's HTTP referrer restrictions, or relax the key restriction for local development.",
      ].join(" ");
    }

    return localized?.message || error.message || fallback;
  } catch {
    return fallback;
  }
}

function getSessionExpiryTime(sessionPayload) {
  const expiryText = String(sessionPayload?.expiry ?? "").trim();
  const expiryTime = Date.parse(expiryText);
  return Number.isFinite(expiryTime) ? expiryTime : null;
}

function buildSessionRequestBody(labelsVisible) {
  const requestBody = {
    mapType: "roadmap",
    language: GOOGLE_MAPS_LANGUAGE || "en-CA",
    region: GOOGLE_MAPS_REGION || "CA",
    scale: "scaleFactor1x",
  };

  if (!labelsVisible) {
    requestBody.styles = LABEL_HIDDEN_STYLES;
  }

  return requestBody;
}

async function postSessionRequest(requestBody) {
  const response = await fetch(
    `${GOOGLE_TILE_BASE_URL}/createSession?key=${encodeURIComponent(
      GOOGLE_MAPS_API_KEY,
    )}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(buildGoogleTilesErrorMessage(message, response.status));
  }

  return response.json();
}

export function hasGoogleMapTilesApiKey() {
  return Boolean(GOOGLE_MAPS_API_KEY);
}

export async function getGoogleRoadmapSession({ labelsVisible = true } = {}) {
  if (!hasGoogleMapTilesApiKey()) {
    throw new Error("Missing VITE_GOOGLE_MAPS_API_KEY.");
  }

  const cacheKey = labelsVisible ? "roadmap:labels" : "roadmap:no-labels";
  const cached = sessionCacheByMode.get(cacheKey);
  const now = Date.now();

  if (
    cached?.promise &&
    (!cached.expiryTime || cached.expiryTime - now > 60_000)
  ) {
    return cached.promise;
  }

  const promise = postSessionRequest(buildSessionRequestBody(labelsVisible))
    .then((payload) => {
      sessionCacheByMode.set(cacheKey, {
        promise: Promise.resolve(payload),
        expiryTime: getSessionExpiryTime(payload),
      });
      return payload;
    })
    .catch((error) => {
      sessionCacheByMode.delete(cacheKey);
      throw error;
    });

  sessionCacheByMode.set(cacheKey, {
    promise,
    expiryTime: null,
  });

  return promise;
}

export function buildGoogleRoadmapTileUrl(sessionValue) {
  return `${GOOGLE_TILE_BASE_URL}/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(
    sessionValue,
  )}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
}
