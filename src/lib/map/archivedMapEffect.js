import { buildArchiveTree } from "@/lib/archiveTree.js";
import { hydrateWorkspaceSubmission } from "@/services/tempCounterProposal.js";
import { getArchiveTreeRecords } from "@/services/tempWorkspace.js";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const ARCHIVED_MAP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 5h2a4 4 0 0 1 4 4v1"/><path d="M8 19h2a4 4 0 0 0 4-4v-1"/><path d="M14 12h2"/></svg>`;

export function hasArchivedMapData(data) {
  return Boolean(data?.dguids?.length);
}

/**
 * Durable Archived Map read. It builds a visual-only latest-version overlay
 * from the commissioner archive API; it never mutates archived records.
 */
export async function loadArchivedMapEffect(profilesByDguid = new Map()) {
  const records = await getArchiveTreeRecords();
  const categories = buildArchiveTree(records, profilesByDguid);
  const latestVersions = categories.flatMap((category) =>
    category.branches.map((branch) => branch.latestVersion).filter(Boolean),
  );
  const dguids = [...new Set(latestVersions.flatMap((version) => [
    version.submission?.dguid,
    version.submission?.neighboring_dguid,
  ]).filter(Boolean).map(String))];
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
    branchCount: latestVersions.length,
  };
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
