import fs from "node:fs";
import path from "node:path";
import {
  loadCurrentCanonicalRelease,
  MapReleaseError,
} from "./canonicalReleaseStore.js";
import { getMapDataRoot } from "../../map-api-service/paths.js";
import { resolvePruidFromProvinceCode } from "../authorization/provinceCatalog.js";

let rolloutAreaByFed = null;

function loadRolloutAreaByFed() {
  if (rolloutAreaByFed) return rolloutAreaByFed;
  const rolloutPath = path.join(getMapDataRoot(), "manifests", "fed_rollout_plan.json");
  const payload = JSON.parse(fs.readFileSync(rolloutPath, "utf8"));
  rolloutAreaByFed = new Map(
    (payload.areas ?? []).map((area) => [String(area.fedNum), area]),
  );
  return rolloutAreaByFed;
}

function getReleaseIndex(release = loadCurrentCanonicalRelease()) {
  return release;
}

export function getDguidDescriptor(release, dguid) {
  const normalized = String(dguid ?? "").trim();
  const descriptor = release.dguids[normalized];
  if (!descriptor) {
    throw new MapReleaseError(`Unknown or unavailable DA: ${normalized}.`, {
      code: "MAP_DA_NOT_FOUND",
      statusCode: 404,
    });
  }
  return {
    dguid: normalized,
    fedNum: String(descriptor.fedNum ?? descriptor.profile?.fed_num ?? ""),
    pruid: String(descriptor.pruid ?? descriptor.profile?.pruid ?? ""),
    enabled: Boolean(descriptor.enabled),
    profile: descriptor.profile ?? null,
  };
}

export function getFedDescriptor(fedNum) {
  const normalized = String(fedNum ?? "").trim();
  const area = loadRolloutAreaByFed().get(normalized);
  if (!area) {
    throw new MapReleaseError(`Unknown FED: ${normalized}.`, {
      code: "MAP_FED_NOT_FOUND",
      statusCode: 404,
    });
  }
  return {
    fedNum: normalized,
    name: area.name ?? `FED ${normalized}`,
    provinceCode: String(area.provinceCode ?? "").toUpperCase(),
    pruid: resolvePruidFromProvinceCode(area.provinceCode),
  };
}

export function listAdjacentDguids(release, dguid) {
  const normalized = String(dguid ?? "").trim();
  return Array.isArray(release.adjacency[normalized]) ? release.adjacency[normalized] : [];
}

export function summarizeDguidForScope(release, dguid) {
  const descriptor = getDguidDescriptor(release, dguid);
  const profile = descriptor.profile ?? {};
  return {
    dguid: descriptor.dguid,
    fedNum: descriptor.fedNum,
    pruid: descriptor.pruid,
    communityName:
      profile.community_display
      ?? profile.community_name
      ?? profile.panel_title
      ?? profile.geo_name
      ?? descriptor.dguid,
    enabled: descriptor.enabled,
  };
}

export function listInScopeNeighbors(release, dguid, operatingPruid, { limit = 40 } = {}) {
  const operating = String(operatingPruid ?? "").trim();
  if (!operating) return [];

  const neighbors = listAdjacentDguids(release, dguid);
  const results = [];
  for (const neighborDguid of neighbors) {
    try {
      const summary = summarizeDguidForScope(release, neighborDguid);
      if (summary.pruid === operating) {
        results.push(summary);
      }
      if (results.length >= limit) break;
    } catch {
      // Skip unknown neighbor descriptors.
    }
  }
  return results.sort((left, right) => left.communityName.localeCompare(right.communityName));
}

export function listInScopeDguidsForFed(release, fedNum, operatingPruid, { limit = 40, offset = 0 } = {}) {
  const operating = String(operatingPruid ?? "").trim();
  const normalizedFed = String(fedNum ?? "").trim();
  const items = Object.entries(release.dguids)
    .filter(([, descriptor]) => String(descriptor.fedNum) === normalizedFed)
    .map(([dguid]) => summarizeDguidForScope(release, dguid))
    .filter((entry) => entry.pruid === operating)
    .sort((left, right) => left.communityName.localeCompare(right.communityName));

  return {
    total: items.length,
    items: items.slice(offset, offset + limit),
  };
}

export function resolveDguidRelationship(release, dguid, operatingPruid) {
  const selected = summarizeDguidForScope(release, dguid);
  const operating = String(operatingPruid ?? "").trim();
  if (!operating) {
    return { relationship: "out_of_scope", selectedArea: selected, inScopeNeighbors: [] };
  }
  if (selected.pruid === operating) {
    return { relationship: "in_scope", selectedArea: selected, inScopeNeighbors: [] };
  }
  const inScopeNeighbors = listInScopeNeighbors(release, dguid, operating);
  if (inScopeNeighbors.length) {
    return { relationship: "adjacent_to_scope", selectedArea: selected, inScopeNeighbors };
  }
  return { relationship: "out_of_scope", selectedArea: selected, inScopeNeighbors: [] };
}

export function resolveFedRelationship(release, fedNum, operatingPruid) {
  const selected = getFedDescriptor(fedNum);
  const operating = String(operatingPruid ?? "").trim();
  if (!operating) {
    return { relationship: "out_of_scope", selectedFed: selected, inScopeNeighbors: [] };
  }
  if (selected.pruid === operating) {
    return { relationship: "in_scope", selectedFed: selected, inScopeNeighbors: [] };
  }

  const borderNeighbors = new Set();
  for (const [dguid, descriptor] of Object.entries(release.dguids)) {
    if (String(descriptor.fedNum) !== selected.fedNum) continue;
    for (const neighborDguid of listAdjacentDguids(release, dguid)) {
      try {
        const neighbor = summarizeDguidForScope(release, neighborDguid);
        if (neighbor.pruid === operating) {
          borderNeighbors.set(neighbor.dguid, neighbor);
        }
      } catch {
        // Ignore unknown neighbors.
      }
    }
  }

  const inScopeNeighbors = [...borderNeighbors.values()]
    .sort((left, right) => left.communityName.localeCompare(right.communityName))
    .slice(0, 40);

  if (inScopeNeighbors.length) {
    return { relationship: "adjacent_to_scope", selectedFed: selected, inScopeNeighbors };
  }
  return { relationship: "out_of_scope", selectedFed: selected, inScopeNeighbors: [] };
}

export function getCurrentReleaseScopeIndex() {
  return getReleaseIndex(loadCurrentCanonicalRelease());
}
