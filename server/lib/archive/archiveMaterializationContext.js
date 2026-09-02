import {
  loadCanonicalRelease,
  readCanonicalDaPair,
  readSharedArcRecord,
} from "../map/canonicalReleaseStore.js";

export class ArchiveMaterializationContext {
  constructor() {
    this.releaseById = new Map();
    this.currentPairByKey = new Map();
    this.baseVerticesByKey = new Map();
    this.mapRevisionByRelease = new Map();
  }

  getRelease(releaseId) {
    const normalized = String(releaseId ?? "").trim();
    if (!this.releaseById.has(normalized)) {
      this.releaseById.set(normalized, loadCanonicalRelease(normalized));
    }
    return this.releaseById.get(normalized);
  }

  async getBaseVertices(release, pair) {
    const key = `${release.manifest.releaseId}:${pair.join("|")}`;
    if (!this.baseVerticesByKey.has(key)) {
      const shared = await readSharedArcRecord(release, pair.join("|"));
      this.baseVerticesByKey.set(key, new Map(shared.chains.flatMap((chain) =>
        chain.vertices.map((vertex) => [vertex[0], {
          vertexId: vertex[0],
          lng: Number(vertex[1]),
          lat: Number(vertex[2]),
          locked: Boolean(vertex[3]),
        }]),
      )));
    }
    return this.baseVerticesByKey.get(key);
  }

  rememberCurrentPair(releaseId, pairKey, value) {
    const key = `${releaseId}:${pairKey}`;
    this.currentPairByKey.set(key, value);
    return value;
  }

  getRememberedCurrentPair(releaseId, pairKey) {
    return this.currentPairByKey.get(`${releaseId}:${pairKey}`) ?? null;
  }

  rememberMapRevision(releaseId, sequence) {
    this.mapRevisionByRelease.set(String(releaseId), Number(sequence) || 0);
    return sequence;
  }

  getRememberedMapRevision(releaseId) {
    return this.mapRevisionByRelease.get(String(releaseId));
  }
}

export async function loadCanonicalPairLayers(context, release, pair, {
  supabase,
  headsQuery,
} = {}) {
  const pairKey = pair.join("|");
  const remembered = context.getRememberedCurrentPair(release.manifest.releaseId, pairKey);
  if (remembered) return remembered;

  const [basePair, headsResult] = await Promise.all([
    readCanonicalDaPair(release, pair[0], pair[1], { representation: "display", lod: "auto" }),
    headsQuery ? headsQuery() : Promise.resolve({ data: [], error: null }),
  ]);
  if (headsResult.error) {
    throw headsResult.error;
  }

  const headsByDguid = new Map((headsResult.data ?? []).map((head) => [String(head.dguid), head]));
  const exactFeatures = pair.map((dguid) => {
    const head = headsByDguid.get(dguid);
    return head && !head.uses_base && head.geometry
      ? head.geometry
      : basePair.features.features.find((feature) =>
        String(feature?.properties?.DGUID ?? feature?.properties?.dguid ?? feature?.id) === dguid,
      );
  });
  const displayFeatures = pair.map((dguid) => {
    const head = headsByDguid.get(dguid);
    return head && !head.uses_base && head.display_geometry
      ? head.display_geometry
      : basePair.features.features.find((feature) =>
        String(feature?.properties?.DGUID ?? feature?.properties?.dguid ?? feature?.id) === dguid,
      );
  });

  return context.rememberCurrentPair(release.manifest.releaseId, pairKey, {
    base: basePair.features.features,
    headsByDguid,
    exact: { type: "FeatureCollection", features: exactFeatures },
    display: { type: "FeatureCollection", features: displayFeatures },
  });
}
