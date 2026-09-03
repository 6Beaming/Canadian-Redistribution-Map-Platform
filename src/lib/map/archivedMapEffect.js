import { getArchivedMapSnapshot } from "@/services/workspaceApi";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const ARCHIVED_MAP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 5h2a4 4 0 0 1 4 4v1"/><path d="M8 19h2a4 4 0 0 0 4-4v-1"/><path d="M14 12h2"/></svg>`;

export function hasArchivedMapData(data) {
  return Boolean(data?.dguids?.length);
}

function snapshotToArchivedMap(snapshot) {
  const dguids = snapshot.dguids?.length
    ? snapshot.dguids
    : (snapshot.heads ?? []).map((head) => head.dguid).filter(Boolean);
  if (!dguids.length) {
    const error = new Error("Archived map snapshot is missing DGUID coverage.");
    error.code = snapshot?.hasV2Branches ? "ARCHIVE_MAP_HEADS_INCOMPLETE" : "ARCHIVE_MAP_SNAPSHOT_EMPTY";
    throw error;
  }
  return {
    dguids,
    overrideDguids: snapshot.overrideDguids ?? [],
    featureCollection: snapshot.featureCollection ?? EMPTY_FEATURE_COLLECTION,
    branchCount: Number(snapshot.branchCount) || 0,
    archiveMapRevision: snapshot.archiveMapRevision ?? 0,
    releaseId: snapshot.releaseId ?? null,
    source: snapshot.source ?? "v2",
  };
}

/**
 * Durable Archived Map read. Requires a complete V2 snapshot; no legacy fallback.
 */
export async function loadArchivedMapEffect(_profilesByDguid = new Map(), { enabled = true } = {}) {
  if (!enabled) return null;

  const snapshot = await getArchivedMapSnapshot([], { includeAllHeads: true });
  if (!snapshot) {
    const error = new Error("Archived map snapshot could not be loaded.");
    error.code = "ARCHIVE_MAP_SNAPSHOT_FAILED";
    throw error;
  }
  if (!snapshot.hasV2Branches && !snapshot.featureCollection?.features?.length) {
    const error = new Error("Archived map is unavailable because no V2 archive branches exist.");
    error.code = "ARCHIVE_MAP_SNAPSHOT_EMPTY";
    throw error;
  }
  return snapshotToArchivedMap(snapshot);
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
