const HEATMAP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1.4 2.1 3.2 3.7 3.2 6a3.2 3.2 0 1 1-6.4 0c0-1.2.5-2.3 1.4-3.5"/><path d="M8 14a4 4 0 0 0 8 0c0-1.4-.7-2.6-1.7-3.6"/><path d="M12 12c.8 1 1.8 1.8 1.8 3.2a1.8 1.8 0 1 1-3.6 0c0-.7.3-1.3.8-2"/></svg>`;

/**
 * Loads the committed demo fixture used by the Commissioner heatmap.
 *
 * This intentionally remains a local, static dataset until a backend
 * aggregation endpoint is available. Keeping the loader here makes that
 * replacement a single-module change instead of a MapCanvas concern.
 */
export async function loadDemoSubmissionHeatmap() {
  const { default: countsByDguid } = await import(
    "@/data/map/indexes/da_submissions.json"
  );

  return { countsByDguid };
}

export function hasSubmissionHeatmapData(heatmap) {
  return Boolean(
    heatmap?.countsByDguid &&
      typeof heatmap.countsByDguid === "object" &&
      Object.keys(heatmap.countsByDguid).length,
  );
}

function buildSubmissionCountExpression(countsByDguid = {}) {
  const expression = ["match", ["to-string", ["get", "DGUID"]]];

  Object.entries(countsByDguid).forEach(([dguid, count]) => {
    expression.push(String(dguid), Number(count) || 0);
  });

  expression.push(0);
  return expression;
}

export function buildSubmissionHeatmapFillExpression(countsByDguid = {}) {
  return [
    "interpolate",
    ["linear"],
    buildSubmissionCountExpression(countsByDguid),
    0, "#fff7bc",
    10, "#fee391",
    25, "#fec44f",
    50, "#fe9929",
    75, "#ec7014",
    100, "#f03b20",
    150, "#de2d26",
    200, "#bd0026",
    220, "#800026",
  ];
}

export function createSubmissionHeatmapControl(
  buttonRef,
  getHeatmapState,
  onToggle,
) {
  return {
    onAdd() {
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "maplibregl-ctrl-icon heatmap-button";
      button.innerHTML = HEATMAP_ICON;
      button.title = "Toggle submission heatmap";
      button.setAttribute("aria-label", "Toggle submission heatmap");
      button.setAttribute("aria-pressed", String(getHeatmapState()));
      button.classList.toggle("active", getHeatmapState());
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
