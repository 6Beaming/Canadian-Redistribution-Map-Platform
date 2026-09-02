import { buildArchiveTree } from "@/lib/archiveTree.js";
import { getArchivedMapSnapshot, getArchiveTreeRecords } from "@/services/workspaceApi";
import { hydrateWorkspaceSubmission } from "@/services/tempCounterProposal.js";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const ARCHIVED_MAP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 5h2a4 4 0 0 1 4 4v1"/><path d="M8 19h2a4 4 0 0 0 4-4v-1"/><path d="M14 12h2"/></svg>`;

export function hasArchivedMapData(data) {
  return Boolean(data?.dguids?.length);
}

function collectDguidsFromRecords(records, profilesByDguid) {
  const categories = buildArchiveTree(records, profilesByDguid);
  return {
    categories,
    dguids: [...new Set(categories.flatMap((category) =>
      category.branches.flatMap((branch) => [
        ...(branch.dguids ?? []),
        branch.latestVersion?.submission?.dguid,
        branch.latestVersion?.submission?.neighboring_dguid,
      ]),
    ).filter(Boolean).map(String))],
    branchCount: categories.reduce((count, category) => count + category.branches.length, 0),
  };
}

async function loadLegacyArchivedMapOverlay(records, profilesByDguid) {
  const { categories, dguids, branchCount } = collectDguidsFromRecords(records, profilesByDguid);
  const latestVersions = categories.flatMap((category) =>
    category.branches.map((branch) => branch.latestVersion).filter(Boolean),
  );
  const hydrated = await Promise.all(latestVersions.map((version) =>
    hydrateWorkspaceSubmission(version.submission, profilesByDguid).catch(() => null),
  ));
  const overrideFeatures = hydrated.flatMap((submission) =>
    submission?.geometry?.proposedFeatureCollection?.features ?? [],
  );

  return {
    dguids,
    overrideDguids: [...new Set(overrideFeatures.map((feature) => String(
      feature?.properties?.DGUID ?? feature?.properties?.dguid ?? feature?.id ?? "",
    )).filter(Boolean))],
    featureCollection: overrideFeatures.length
      ? { type: "FeatureCollection", features: overrideFeatures }
      : EMPTY_FEATURE_COLLECTION,
    branchCount,
    source: "legacy",
  };
}

function snapshotToArchivedMap(snapshot, fallbackDguids = []) {
  const dguids = snapshot.dguids?.length
    ? snapshot.dguids
    : (snapshot.heads ?? []).map((head) => head.dguid).filter(Boolean);
  return {
    dguids: dguids.length ? dguids : fallbackDguids,
    overrideDguids: snapshot.overrideDguids ?? [],
    featureCollection: snapshot.featureCollection ?? EMPTY_FEATURE_COLLECTION,
    branchCount: Number(snapshot.branchCount) || 0,
    archiveMapRevision: snapshot.archiveMapRevision ?? 0,
    releaseId: snapshot.releaseId ?? null,
    source: snapshot.source ?? "v2",
  };
}

/**
 * Durable Archived Map read. Prefers archive_map_da_heads when materialized.
 * Empty V2 snapshots must not trigger legacy hydration when V2 branches exist.
 */
export async function loadArchivedMapEffect(profilesByDguid = new Map(), { enabled = true } = {}) {
  if (!enabled) return null;

  try {
    const snapshot = await getArchivedMapSnapshot([], { includeAllHeads: true });
    if (snapshot?.hasV2Branches) {
      const snapshotDguids = snapshot.dguids?.length
        ? snapshot.dguids
        : (snapshot.heads ?? []).map((head) => head.dguid).filter(Boolean);
      if (snapshotDguids.length) {
        return snapshotToArchivedMap(snapshot, snapshotDguids);
      }
      const { dguids } = collectDguidsFromRecords(await getArchiveTreeRecords(), profilesByDguid);
      return snapshotToArchivedMap(snapshot, dguids);
    }
    if (snapshot?.featureCollection?.features?.length) {
      return snapshotToArchivedMap(snapshot);
    }
  } catch {
    // Fall through to legacy only when V2 infrastructure is unavailable.
  }

  const records = await getArchiveTreeRecords();
  const hasV2Records = records.some((record) => record.branchId);
  if (hasV2Records) {
    const { dguids, branchCount } = collectDguidsFromRecords(records, profilesByDguid);
    return {
      dguids,
      overrideDguids: [],
      featureCollection: EMPTY_FEATURE_COLLECTION,
      branchCount,
      archiveMapRevision: 0,
      releaseId: null,
      source: "v2-empty-heads",
    };
  }

  return loadLegacyArchivedMapOverlay(records, profilesByDguid);
}

export function createArchivedMapControl(buttonRef, getEnabled, onToggle) {
  return {
    onAdd() {
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "maplibregl-ctrl-icon archived-map-button";
      button.innerHTML = ARCHIVED_MAP_ICON;
      button.title = "Toggle archived map versions";
      button.setAttribute("aria-label", "Toggle archived map versions");
      button.setAttribute("aria-pressed", String(getEnabled()));
      button.classList.toggle("active", getEnabled());
      button.addEventListener("click", onToggle);
      buttonRef.current = button;
      container.appendChild(button);
      return container;
    },
    onRemove() {
      buttonRef.current = null;
    },
  };
}
