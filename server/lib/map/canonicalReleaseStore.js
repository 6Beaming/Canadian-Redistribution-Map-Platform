import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getMapDataRoot } from "../../map-api-service/paths.js";

const releaseCache = new Map();
const openHandles = new Map();

export class MapReleaseError extends Error {
  constructor(message, { code = "MAP_RELEASE_INVALID", statusCode = 409 } = {}) {
    super(message);
    this.name = "MapReleaseError";
    this.code = code;
    this.statusCode = statusCode;
    this.publicMessage = message;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getReleaseRoot(releaseId) {
  const normalized = String(releaseId ?? "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(normalized)) {
    throw new MapReleaseError("Invalid map release ID.", { statusCode: 400 });
  }
  const releasesRoot = path.resolve(getMapDataRoot(), "releases");
  const releaseRoot = path.resolve(releasesRoot, normalized);
  if (!releaseRoot.startsWith(`${releasesRoot}${path.sep}`)) {
    throw new MapReleaseError("Invalid map release ID.", { statusCode: 400 });
  }
  return releaseRoot;
}

function resolveReleaseArtifact(release, relativePath) {
  const artifactPath = path.resolve(release.root, String(relativePath ?? ""));
  if (!artifactPath.startsWith(`${release.root}${path.sep}`) || !fs.existsSync(artifactPath)) {
    throw new MapReleaseError("Map release artifact is unavailable.", {
      code: "MAP_RELEASE_ARTIFACT_MISSING",
      statusCode: 503,
    });
  }
  return artifactPath;
}

async function readRange(filePath, offset, length) {
  let handlePromise = openHandles.get(filePath);
  if (!handlePromise) {
    handlePromise = fs.promises.open(filePath, "r");
    openHandles.set(filePath, handlePromise);
  }
  const handle = await handlePromise;
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  if (bytesRead !== length) {
    throw new MapReleaseError("Map release byte range is incomplete.", {
      code: "MAP_RELEASE_RANGE_INVALID",
      statusCode: 503,
    });
  }
  return buffer;
}

export function loadCurrentReleasePointer() {
  const pointerPath = path.join(getMapDataRoot(), "current-release.json");
  if (!fs.existsSync(pointerPath)) {
    throw new MapReleaseError("Current map release is not installed.", {
      code: "MAP_RELEASE_NOT_INSTALLED",
      statusCode: 503,
    });
  }
  return readJson(pointerPath);
}

export function loadCanonicalRelease(releaseId) {
  const normalized = String(releaseId ?? "").trim();
  if (releaseCache.has(normalized)) {
    return releaseCache.get(normalized);
  }
  const root = getReleaseRoot(normalized);
  const manifestPath = path.join(root, "release.json");
  if (!fs.existsSync(manifestPath)) {
    throw new MapReleaseError("Map release was not found.", {
      code: "MAP_RELEASE_NOT_FOUND",
      statusCode: 404,
    });
  }
  const manifest = readJson(manifestPath);
  if (manifest.releaseId !== normalized) {
    throw new MapReleaseError("Map release manifest identity is invalid.", { statusCode: 503 });
  }
  const release = {
    root,
    manifest,
    dguids: readJson(path.join(root, "indexes", "dguids.json")).items ?? {},
    adjacency: readJson(path.join(root, "indexes", "adjacency.json")).items ?? {},
    sharedArcs: readJson(path.join(root, "topology", "shared-arcs.index.json")).items ?? {},
  };
  releaseCache.set(normalized, release);
  return release;
}

export function loadCurrentCanonicalRelease() {
  const pointer = loadCurrentReleasePointer();
  const release = loadCanonicalRelease(pointer.releaseId);
  if (pointer.manifestSha256 !== release.manifest.manifestSha256) {
    throw new MapReleaseError("Current map release pointer does not match its manifest.", {
      code: "MAP_RELEASE_MISMATCH",
      statusCode: 503,
    });
  }
  return release;
}

export async function readExactDaFeature(release, dguid) {
  const normalized = String(dguid ?? "").trim();
  const descriptor = release.dguids[normalized];
  if (!descriptor) {
    throw new MapReleaseError(`Unknown or unavailable DA: ${normalized}.`, {
      code: "MAP_DA_NOT_FOUND",
      statusCode: 404,
    });
  }
  const shardPath = resolveReleaseArtifact(release, descriptor.shard);
  const buffer = await readRange(shardPath, descriptor.offset, descriptor.length);
  return { descriptor, feature: JSON.parse(buffer.toString("utf8")) };
}

function canonicalPair(first, second) {
  const dguids = [String(first ?? "").trim(), String(second ?? "").trim()].sort();
  if (!dguids[0] || !dguids[1] || dguids[0] === dguids[1]) {
    throw new MapReleaseError("Two distinct DGUIDs are required.", { statusCode: 400 });
  }
  return { dguids, key: dguids.join("|") };
}

export async function readSharedArcRecord(release, key) {
  const descriptor = release.sharedArcs[key];
  if (!descriptor) {
    throw new MapReleaseError("The selected DAs are not adjacent.", {
      code: "MAP_DA_PAIR_NOT_ADJACENT",
      statusCode: 400,
    });
  }
  const filePath = resolveReleaseArtifact(release, descriptor.shard);
  const buffer = await readRange(filePath, descriptor.offset, descriptor.length);
  return JSON.parse(buffer.toString("utf8").trim());
}

function chooseLod(record, requestedLod = "auto", maxHandles = 1500) {
  const levels = ["fine", "medium", "coarse"];
  if (requestedLod !== "auto") {
    if (!levels.includes(requestedLod)) {
      throw new MapReleaseError("Unknown display LOD.", { statusCode: 400 });
    }
    return requestedLod;
  }
  return levels.find((level) =>
    record.chains.reduce((count, chain) => count + (chain.lods?.[level]?.length ?? 0), 0) <= maxHandles
  ) ?? "coarse";
}

function buildSharedBoundary(record, level) {
  return {
    type: "FeatureCollection",
    features: record.chains.map((chain) => ({
      type: "Feature",
      id: chain.arcId,
      properties: { arcId: chain.arcId, pair: record.pair, lod: level },
      geometry: {
        type: "LineString",
        coordinates: chain.lods[level].map((index) => [chain.vertices[index][1], chain.vertices[index][2]]),
      },
    })),
  };
}

function lodIndexesAreEndpointOnly(chain, indexes) {
  if (!Array.isArray(indexes) || indexes.length <= 2) {
    return true;
  }
  return indexes.every((vertexIndex, index, arr) => (
    index === 0
    || index === arr.length - 1
    || Boolean(chain.vertices[vertexIndex]?.[3])
  ));
}

function buildEditableHandles(record, level) {
  return record.chains.flatMap((chain) => {
    let indexes = [...(chain.lods[level] ?? [])];
    // Display LODs often collapse short shared arcs to endpoints even when the
    // full chain still has unlocked catalog interiors. Edit handles must keep
    // those interiors addressable with stable release vertex IDs — otherwise
    // clients invent synthetic midpoints that fail submission validation.
    if (lodIndexesAreEndpointOnly(chain, indexes) && chain.vertices.length > 2) {
      indexes = chain.vertices.map((_, vertexIndex) => vertexIndex);
    }
    return indexes.map((vertexIndex, index, resolvedIndexes) => {
      const exact = chain.vertices[vertexIndex];
      return {
        vertexId: exact?.[0] ?? null,
        coordinate: exact ? [exact[1], exact[2]] : null,
        arcId: chain.arcId,
        locked: Boolean(
          exact?.[3]
          || index === 0
          || index === resolvedIndexes.length - 1,
        ),
      };
    }).filter((vertex) => vertex.vertexId);
  });
}

export async function readCanonicalDaPair(release, first, second, options = {}) {
  const pair = canonicalPair(first, second);
  const [primary, secondary, shared] = await Promise.all([
    readExactDaFeature(release, pair.dguids[0]),
    readExactDaFeature(release, pair.dguids[1]),
    readSharedArcRecord(release, pair.key),
  ]);
  const lod = chooseLod(shared, options.lod ?? "auto", options.maxHandles);
  const representation = options.representation === "edit" ? "edit" : "display";
  if (representation === "edit" && (!primary.descriptor.enabled || !secondary.descriptor.enabled)) {
    throw new MapReleaseError("Edit representation requires two Enabled dissemination areas.", {
      code: "MAP_DA_PAIR_NOT_ENABLED",
      statusCode: 409,
    });
  }
  return {
    releaseId: release.manifest.releaseId,
    baseRevision: release.manifest.geometryRevision,
    topologyRevision: release.manifest.topologyRevision,
    requestedDguids: [String(first), String(second)],
    canonicalDguids: pair.dguids,
    representation,
    lod,
    exactDigest: `sha256:${crypto.createHash("sha256").update(
      `${primary.descriptor.sha256}|${secondary.descriptor.sha256}`,
    ).digest("hex")}`,
    features: { type: "FeatureCollection", features: [primary.feature, secondary.feature] },
    sharedBoundary: buildSharedBoundary(shared, lod),
    editableHandles: representation === "edit" ? buildEditableHandles(shared, lod) : [],
  };
}

export function clearCanonicalReleaseCacheForTests() {
  releaseCache.clear();
}
