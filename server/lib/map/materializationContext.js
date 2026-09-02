import { AsyncLocalStorage } from "node:async_hooks";
import {
  loadCanonicalRelease,
  readCanonicalDaPair,
  readSharedArcRecord,
} from "./canonicalReleaseStore.js";

const storage = new AsyncLocalStorage();

function pairKey(primaryDguid, secondaryDguid, representation, lod) {
  const pair = [String(primaryDguid ?? "").trim(), String(secondaryDguid ?? "").trim()].sort();
  return `${pair.join("|")}:${representation}:${lod}`;
}

export class MaterializationContext {
  constructor() {
    this.releaseById = new Map();
    this.pairByKey = new Map();
    this.sharedArcByKey = new Map();
    this.vertexCatalogByKey = new Map();
    this.digests = new Map();
  }

  getRelease(releaseId) {
    const normalized = String(releaseId ?? "").trim();
    if (!this.releaseById.has(normalized)) {
      this.releaseById.set(normalized, loadCanonicalRelease(normalized));
    }
    return this.releaseById.get(normalized);
  }

  async getCanonicalDaPair(release, primaryDguid, secondaryDguid, options = {}) {
    const representation = options.representation ?? "display";
    const lod = options.lod ?? "auto";
    const key = `${release.manifest.releaseId}:${pairKey(primaryDguid, secondaryDguid, representation, lod)}`;
    if (!this.pairByKey.has(key)) {
      this.pairByKey.set(key, await readCanonicalDaPair(
        release,
        primaryDguid,
        secondaryDguid,
        { representation, lod },
      ));
    }
    return this.pairByKey.get(key);
  }

  async getSharedArc(release, primaryDguid, secondaryDguid) {
    const pair = [String(primaryDguid ?? "").trim(), String(secondaryDguid ?? "").trim()].sort();
    const key = `${release.manifest.releaseId}:${pair.join("|")}`;
    if (!this.sharedArcByKey.has(key)) {
      this.sharedArcByKey.set(key, await readSharedArcRecord(release, pair.join("|")));
    }
    return this.sharedArcByKey.get(key);
  }

  async getVertexCatalog(release, primaryDguid, secondaryDguid) {
    const pair = [String(primaryDguid ?? "").trim(), String(secondaryDguid ?? "").trim()].sort();
    const key = `${release.manifest.releaseId}:${pair.join("|")}`;
    if (!this.vertexCatalogByKey.has(key)) {
      const shared = await this.getSharedArc(release, pair[0], pair[1]);
      const vertexById = new Map(shared.chains.flatMap((chain) =>
        chain.vertices.map((vertex) => [vertex[0], {
          vertexId: vertex[0],
          base: [vertex[1], vertex[2]],
          locked: Boolean(vertex[3]),
        }]),
      ));
      this.vertexCatalogByKey.set(key, { pair, vertexById });
    }
    return this.vertexCatalogByKey.get(key);
  }

  rememberDigest(key, value) {
    if (!this.digests.has(key)) {
      this.digests.set(key, value);
    }
    return this.digests.get(key);
  }
}

export function getMaterializationContext() {
  return storage.getStore() ?? null;
}

export function runWithMaterializationContext(fn, context = new MaterializationContext()) {
  return storage.run(context, fn);
}
