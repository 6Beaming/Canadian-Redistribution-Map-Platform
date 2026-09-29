import { getSubmissionHeatmap } from "@/services/workspaceApi";

const HEATMAP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" fill="#dc2626" class="bi bi-fire" viewBox="0 0 16 16" id="Fire--Streamline-Bootstrap" height="16" width="16" aria-hidden="true"><path d="M8 16c3.314 0 6-2 6-5.5 0-1.5-.5-4-2.5-6 .25 1.5-1.25 2-1.25 2C11 4 9 .5 6 0c.357 2 .5 4-2 6-1.25 1-2 2.729-2 4.5C2 14 4.686 16 8 16m0-1c-1.657 0-3-1-3-2.75 0-.75.25-2 1.25-3C6.125 10 7 10.5 7 10.5c-.375-1.25.5-3.25 2-3.5-.179 1-.25 2 1 3 .625.5 1 1.364 1 2.25C11 14 9.657 15 8 15" stroke-width="1"></path></svg>`;

/**
 * Dashboard heatmap counts are independent of Table/Workspace pagination.
 */
export async function loadSubmissionHeatmap() {
  return getSubmissionHeatmap();
}

export const loadDemoSubmissionHeatmap = loadSubmissionHeatmap;

export function hasSubmissionHeatmapData(heatmap) {
  return Boolean(
    heatmap?.countsByDguid &&
    typeof heatmap.countsByDguid === "object",
  );
}

function buildSubmissionCountExpression(countsByDguid = {}) {
  if (!Object.keys(countsByDguid).length) return 0;
  const expression = ["match", ["to-string", ["get", "DGUID"]]];

  Object.entries(countsByDguid).forEach(([dguid, count]) => {
    expression.push(String(dguid), Number(count) || 0);
  });

  expression.push(0);
  return expression;
}

export const SUBMISSION_HEATMAP_SCALE = Object.freeze([
  { min: 0, label: "0", color: "#e2e8f0" },
  { min: 1, label: "1–2", color: "#fed976" },
  { min: 3, label: "3–5", color: "#feb24c" },
  { min: 6, label: "6–10", color: "#fd8d3c" },
  { min: 11, label: "11–25", color: "#e31a1c" },
  { min: 26, label: "26+", color: "#800026" },
]);

export function buildSubmissionHeatmapFillExpression(countsByDguid = {}, operatingPruid = null) {
  // Counts can include the neighboring side of a cross-province submission.
  // Neither those colors nor the zero-count background belong outside our scope.
  if (!operatingPruid) return "rgba(0,0,0,0)";
  return [
    "case",
    [
      "==",
      ["slice", ["to-string", ["coalesce", ["get", "fed_num"], ["get", "FED_NUM"], ""]], 0, 2],
      String(operatingPruid),
    ],
    [
      "step",
      buildSubmissionCountExpression(countsByDguid),
      SUBMISSION_HEATMAP_SCALE[0].color,
      ...SUBMISSION_HEATMAP_SCALE.slice(1).flatMap(({ min, color }) => [min, color]),
    ],
    "rgba(0,0,0,0)",
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
