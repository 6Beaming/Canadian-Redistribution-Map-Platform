import { mapApi } from "@/services/mapApi.js";
import { buildDaObjectionIndex } from "./objectionWorkflow.js";
import { buildCounterProposalCache } from "./counterProposalWorkflow.js";

let cachedReleaseId = null;

async function resolveReleaseId() {
  if (!cachedReleaseId) {
    const current = await mapApi.getCurrentRelease();
    cachedReleaseId = current.releaseId;
  }
  return cachedReleaseId;
}

export function clearReleasePairLoaderCache() {
  cachedReleaseId = null;
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
  const index = buildDaObjectionIndex(payload.features);
  const cache = buildCounterProposalCache(index, profilesByDguid, firstDguid, secondDguid);
  return { index, payload, cache };
}

export async function areReleaseDaNeighbours(firstDguid, secondDguid, { signal } = {}) {
  try {
    await loadDisplayPairIndex(firstDguid, secondDguid, { signal });
    return true;
  } catch (error) {
    if (error.code === "MAP_DA_PAIR_NOT_ADJACENT" || error.status === 400) {
      return false;
    }
    throw error;
  }
}
