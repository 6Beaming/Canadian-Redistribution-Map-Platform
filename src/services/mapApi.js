const MAP_API_BASE = "/api/map";

const MAX_PROFILE_CACHE_ENTRIES = 4;
const MAX_STATIC_ASSET_CACHE_ENTRIES = 16;
const MAX_GEOMETRY_CACHE_ENTRIES = 24;
const MAX_GEOMETRY_CACHE_BYTES = 12 * 1024 * 1024;

function estimateJsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

function createPromiseCache({ maxEntries, maxBytes = null, shouldCache = () => true }) {
  const entries = new Map();

  function evict() {
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  function remember(key, factory) {
    if (entries.has(key)) return entries.get(key);
    const promise = factory()
      .then((value) => {
        if (!shouldCache(value)) {
          entries.delete(key);
        }
        return value;
      })
      .catch((error) => {
        entries.delete(key);
        throw error;
      });
    entries.set(key, promise);
    evict();
    return promise;
  }

  function clear() {
    entries.clear();
  }

  return { remember, clear };
}

const profileIndexCache = createPromiseCache({ maxEntries: MAX_PROFILE_CACHE_ENTRIES });
const staticAssetCache = createPromiseCache({ maxEntries: MAX_STATIC_ASSET_CACHE_ENTRIES });
const geometryCache = createPromiseCache({
  maxEntries: MAX_GEOMETRY_CACHE_ENTRIES,
  shouldCache: (value) => estimateJsonBytes(value) <= MAX_GEOMETRY_CACHE_BYTES,
});

function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true });
    }),
  ]);
}

async function request(path, options = {}) {
  const response = await fetch(`${MAP_API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || `Map API request failed (${response.status}).`);
    error.code = data.code ?? null;
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export const mapApi = {
  assetUrl(filename) {
    return `${MAP_API_BASE}/assets/${filename}`;
  },

  absoluteAssetUrl(filename) {
    return new URL(this.assetUrl(filename), window.location.origin).href;
  },

  getDaProfiles() {
    return profileIndexCache.remember("da-profiles", () => request("/da-profiles"));
  },

  getDaAssetManifest() {
    return this.fetchAssetJson("manifests/da_asset_manifest.json");
  },

  getCurrentRelease(options = {}) {
    return request("/releases/current", { signal: options.signal });
  },

  getReleaseAdjacency(releaseId, { signal } = {}) {
    const key = `adjacency:${releaseId}`;
    const promise = geometryCache.remember(key, () => request(
      `/releases/${encodeURIComponent(releaseId)}/adjacency`,
    ));
    return withAbort(promise, signal);
  },

  getReleaseDa(releaseId, dguid, { representation = "display", signal } = {}) {
    const key = `da:${releaseId}:${dguid}:${representation}`;
    const promise = geometryCache.remember(key, () => request(
      `/releases/${encodeURIComponent(releaseId)}/das/${encodeURIComponent(dguid)}?representation=${encodeURIComponent(representation)}`,
    ));
    return withAbort(promise, signal);
  },

  getReleaseDaPair(releaseId, primaryDguid, secondaryDguid, {
    representation = "display",
    lod = "auto",
    signal,
  } = {}) {
    const pair = [String(primaryDguid), String(secondaryDguid)].sort();
    const key = `pair:${releaseId}:${pair.join("|")}:${representation}:${lod}:v3-edit-handles`;
    const promise = geometryCache.remember(key, () => request(
      `/releases/${encodeURIComponent(releaseId)}/da-pairs/${encodeURIComponent(pair[0])}/${encodeURIComponent(pair[1])}`
        + `?representation=${encodeURIComponent(representation)}&lod=${encodeURIComponent(lod)}`,
    ));
    return withAbort(promise, signal);
  },

  clearImmutableReleaseCache() {
    profileIndexCache.clear();
    staticAssetCache.clear();
    geometryCache.clear();
  },

  getAssignments() {
    return request("/assignments");
  },

  saveAssignments(assignments) {
    return request("/assignments", {
      method: "PUT",
      body: JSON.stringify({ assignments }),
    });
  },

  async fetchAssetJson(filename) {
    const promise = staticAssetCache.remember(`asset:${filename}`, async () => {
      const response = await fetch(this.assetUrl(filename));
      if (!response.ok) {
        throw new Error(`Failed to load ${filename} (${response.status}).`);
      }
      return response.json();
    });
    return promise;
  },

  async assetExists(filename) {
    try {
      const response = await fetch(this.assetUrl(filename), {
        method: "HEAD",
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async supportsByteServing(filename) {
    try {
      const response = await fetch(this.assetUrl(filename), {
        headers: { Range: "bytes=0-1" },
      });
      if (response.status !== 206) return false;

      const contentRange = response.headers.get("Content-Range");
      const contentLength = Number(response.headers.get("Content-Length") ?? "0");
      if (!contentRange || !contentRange.startsWith("bytes ")) return false;
      if (contentLength > 2) return false;

      return true;
    } catch {
      return false;
    }
  },
};
