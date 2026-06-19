const STORAGE_KEY = "crmp-assignment-v1";

const DISTRICT_PALETTE = [
  "#4e79a7",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
];

const assignmentTable = {};

function loadAssignment() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      Object.assign(assignmentTable, parsed);
    }
  } catch (error) {
    console.warn("[WARN] Could not load assignment from localStorage", error);
  }
}

function saveAssignment() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(assignmentTable));
}

function getDistrictColor(districtId) {
  const index = Math.abs(Number(districtId)) % DISTRICT_PALETTE.length;
  return DISTRICT_PALETTE[index];
}

function cycleDistrictId(current) {
  const next = current === undefined ? 0 : Number(current) + 1;
  return next > DISTRICT_PALETTE.length - 1 ? 0 : next;
}

function applyAssignmentToMap(map, dguid, districtId) {
  map.setFeatureState(
    { source: "das", id: dguid },
    { districtColor: getDistrictColor(districtId) }
  );
}

function restoreAssignments(map) {
  Object.entries(assignmentTable).forEach(([dguid, districtId]) => {
    applyAssignmentToMap(map, dguid, districtId);
  });
}

function clearSelection(map, dguid) {
  if (!dguid) return;
  map.setFeatureState({ source: "das", id: dguid }, { selected: false });
}

function selectDa(map, dguid) {
  map.setFeatureState({ source: "das", id: dguid }, { selected: true });
}
