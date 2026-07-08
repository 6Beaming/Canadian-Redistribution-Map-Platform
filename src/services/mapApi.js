const MAP_API_BASE = "/api/map";

async function request(path, options = {}) {
  const response = await fetch(`${MAP_API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Map API request failed (${response.status}).`);
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
    return request("/da-profiles");
  },

  getDaAssetManifest() {
    return this.fetchAssetJson("manifests/da_asset_manifest.json");
  },

  getAssignments() {
    return request("/assignments");
  },

  saveAssignments(assignments) {
    return request("/assignments", {
      method: "PUT",
      body: JSON.stringify({ assignments })
    });
  },

  async fetchAssetJson(filename) {
    const response = await fetch(this.assetUrl(filename));
    if (!response.ok) {
      throw new Error(`Failed to load ${filename} (${response.status}).`);
    }
    return response.json();
  },

  async assetExists(filename) {
    try {
      const response = await fetch(this.assetUrl(filename), {
        method: "HEAD"
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async supportsByteServing(filename) {
    try {
      const response = await fetch(this.assetUrl(filename), {
        headers: { Range: "bytes=0-1" }
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
  }
};
