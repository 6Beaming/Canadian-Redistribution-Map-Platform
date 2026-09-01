import { mapApi } from "@/services/mapApi.js";
import { buildDaObjectionIndex } from "./objectionWorkflow.js";
import { buildCounterProposalCacheFromReleasePair } from "./counterProposalWorkflow.js";

let cachedReleaseId = null;
let cachedAdjacencyByDguid = null;
let cachedAdjacencyReleaseId = null;

async function resolveReleaseId() {
  if (!cachedReleaseId) {
    const current = await mapApi.getCurrentRelease();
    cachedReleaseId = current.releaseId;
  }
  return cachedReleaseId;
}

async function loadAdjacencyIndex(releaseId, { signal } = {}) {
  if (cachedAdjacencyReleaseId === releaseId && cachedAdjacencyByDguid) {
    return cachedAdjacencyByDguid;
  }
  const payload = await mapApi.getReleaseAdjacency(releaseId, { signal });
  cachedAdjacencyReleaseId = releaseId;
  cachedAdjacencyByDguid = payload.items ?? {};
  return cachedAdjacencyByDguid;
}

export function clearReleasePairLoaderCache() {
  cachedReleaseId = null;
  cachedAdjacencyByDguid = null;
  cachedAdjacencyReleaseId = null;
  mapApi.clearImmutableReleaseCache();
}

export async function loadDisplayDaIndex(dguid, { signal } = {}) {
  const releaseId = await resolveReleaseId();
  const payload = await mapApi.getReleaseDa(releaseId, dguid, { signal });
  return buildDaObjectionIndex({
    type: "FeatureCollection",
    features: [payload.feature],
  });
}

export async function loadDisplayPairIndex(firstDguid, secondDguid, { signal } = {}) {
  const releaseId = await resolveReleaseId();
  const payload = await mapApi.getReleaseDaPair(releaseId, firstDguid, secondDguid, {
    representation: "display",
    signal,
  });
  return buildDaObjectionIndex(payload.features);
}

export async function loadCounterProposalPair(firstDguid, secondDguid, profilesByDguid, { signal } = {}) {
  const releaseId = await resolveReleaseId();
  const payload = await mapApi.getReleaseDaPair(releaseId, firstDguid, secondDguid, {
    representation: "edit",
    signal,
  });
  const cache = buildCounterProposalCacheFromReleasePair(
    payload,
    profilesByDguid,
    firstDguid,
    secondDguid,
  );
  const index = cache?.pairIndex ?? buildDaObjectionIndex(payload.features);
  return { index, payload, cache };
}

export async function areReleaseDaNeighbours(firstDguid, secondDguid, { signal } = {}) {
  const releaseId = await resolveReleaseId();
  const adjacency = await loadAdjacencyIndex(releaseId, { signal });
  const neighbors = adjacency[String(firstDguid)] ?? [];
  return neighbors.includes(String(secondDguid));
}
