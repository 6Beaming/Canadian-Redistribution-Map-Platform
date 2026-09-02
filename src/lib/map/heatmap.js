import { getSubmissionHeatmap } from "@/services/workspaceApi";

const HEATMAP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" fill="#dc2626" class="bi bi-fire" viewBox="0 0 16 16" id="Fire--Streamline-Bootstrap" height="16" width="16" aria-hidden="true"><path d="M8 16c3.314 0 6-2 6-5.5 0-1.5-.5-4-2.5-6 .25 1.5-1.25 2-1.25 2C11 4 9 .5 6 0c.357 2 .5 4-2 6-1.25 1-2 2.729-2 4.5C2 14 4.686 16 8 16m0-1c-1.657 0-3-1-3-2.75 0-.75.25-2 1.25-3C6.125 10 7 10.5 7 10.5c-.375-1.25.5-3.25 2-3.5-.179 1-.25 2 1 3 .625.5 1 1.364 1 2.25C11 14 9.657 15 8 15" stroke-width="1"></path></svg>`;

/**
 * Transitional Commissioner heatmap loader. It currently aggregates protected
 * live submissions and local fixtures; replace its tempWorkspace dependency
 * with a compact authenticated server aggregate without changing MapCanvas.
 */
export async function loadSubmissionHeatmap() {
  return getSubmissionHeatmap();
}

export const loadDemoSubmissionHeatmap = loadSubmissionHeatmap;

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
  const positiveCounts = Object.values(countsByDguid)
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0);

  if (!positiveCounts.length) {
    return [
      "rgba",
      0,
      0,
      0,
      0,
    ];
  }

  const maxIntensity = Math.max(Math.max(...positiveCounts), 2);

  return [
    "interpolate",
    ["linear"],
    buildSubmissionCountExpression(countsByDguid),
    0, "rgba(0,0,0,0)",
    maxIntensity * 0.05, "#fff7ed", // almost white
    maxIntensity * 0.20, "#fdba74", // light orange
    maxIntensity * 0.40, "#fb923c", // orange
    maxIntensity * 0.60, "#ef4444", // bright red
    maxIntensity * 0.80, "#b91c1c", // dark red
    maxIntensity, "#450a0a",        // hotspot
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
