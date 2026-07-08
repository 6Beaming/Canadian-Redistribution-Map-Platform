const FALLBACK_MANIFEST = {
  version: 1,
  generatedAt: null,
  combined: {
    renderPmtiles: "render/da_boundaries_available.pmtiles",
    renderGeojsonFallback: "",
    labelGeojson: "render/da_labels_available.geojson",
    sourceLayer: "da_boundaries_available",
    minZoom: 5,
    maxZoom: 12,
  },
  profiles: {
    json: "indexes/da_profile_index.json",
  },
  assets: [
    {
      fedNum: "60001",
      provinceCode: "yt",
      metadataGeojsons: ["metadata/fed_60001.geojson"],
      renderIncluded: true,
    },
  ],
};

function normalizeAsset(asset) {
  const metadataGeojsons = Array.isArray(asset?.metadataGeojsons)
    ? asset.metadataGeojsons
    : [];

  return {
    fedNum: String(asset?.fedNum ?? "").trim(),
    fedName: String(asset?.fedName ?? "").trim(),
    provinceCode: String(asset?.provinceCode ?? "").trim().toLowerCase(),
    metadataGeojsons: metadataGeojsons
      .map((path) => String(path ?? "").trim())
      .filter(Boolean),
    shardCount: Number(asset?.shardCount ?? metadataGeojsons.length ?? 0),
    renderIncluded: asset?.renderIncluded !== false,
    featureCount: Number(asset?.featureCount ?? 0),
  };
}

export function normalizeDaAssetManifest(manifest) {
  const assets = Array.isArray(manifest?.assets)
    ? manifest.assets
        .map(normalizeAsset)
        .filter((asset) => asset.fedNum && asset.metadataGeojsons.length)
    : FALLBACK_MANIFEST.assets;

  return {
    version: Number(manifest?.version ?? FALLBACK_MANIFEST.version),
    generatedAt: manifest?.generatedAt ?? FALLBACK_MANIFEST.generatedAt,
    combined: {
      renderPmtiles:
        String(
          manifest?.combined?.renderPmtiles ??
            FALLBACK_MANIFEST.combined.renderPmtiles,
        ).trim(),
      renderGeojsonFallback:
        String(
          manifest?.combined?.renderGeojsonFallback ??
            FALLBACK_MANIFEST.combined.renderGeojsonFallback,
        ).trim(),
      labelGeojson:
        String(
          manifest?.combined?.labelGeojson ??
            FALLBACK_MANIFEST.combined.labelGeojson,
        ).trim(),
      minZoom: Number(
        manifest?.combined?.minZoom ?? FALLBACK_MANIFEST.combined.minZoom,
      ),
      maxZoom: Number(
        manifest?.combined?.maxZoom ?? FALLBACK_MANIFEST.combined.maxZoom,
      ),
      sourceLayer:
        String(
          manifest?.combined?.sourceLayer ??
            FALLBACK_MANIFEST.combined.sourceLayer,
        ).trim(),
    },
    profiles: {
      json: String(manifest?.profiles?.json ?? FALLBACK_MANIFEST.profiles.json).trim(),
    },
    assets,
  };
}

export function getFallbackDaAssetManifest() {
  return normalizeDaAssetManifest(FALLBACK_MANIFEST);
}

export function getMetadataGeojsonPathsForFed(manifest, fedNum) {
  const normalizedManifest = normalizeDaAssetManifest(manifest);
  return (
    normalizedManifest.assets.find((asset) => asset.fedNum === String(fedNum))?.metadataGeojsons ??
    normalizedManifest.assets[0]?.metadataGeojsons ??
    []
  );
}

export function getDaRenderPmtilesPath(manifest) {
  return normalizeDaAssetManifest(manifest).combined.renderPmtiles;
}

export function getDaRenderGeojsonFallbackPath(manifest) {
  return normalizeDaAssetManifest(manifest).combined.renderGeojsonFallback;
}

export function getDaLabelGeojsonPath(manifest) {
  return normalizeDaAssetManifest(manifest).combined.labelGeojson;
}

export function getDaRenderSourceLayer(manifest) {
  return normalizeDaAssetManifest(manifest).combined.sourceLayer;
}

export function getDaRenderMinZoom(manifest) {
  return normalizeDaAssetManifest(manifest).combined.minZoom;
}

export function getDaRenderMaxZoom(manifest) {
  return normalizeDaAssetManifest(manifest).combined.maxZoom;
}

export function getDaProfilesPath(manifest) {
  const normalizedManifest = normalizeDaAssetManifest(manifest);
  return normalizedManifest.profiles.json;
}
