export const SUBMISSION_STATUS_SERIES = Object.freeze([
  { id: "pending", label: "Pending", color: "#f59e0b" },
  { id: "accepted", label: "Accepted", color: "#16a34a" },
  { id: "rejected", label: "Rejected", color: "#dc2626" },
  { id: "archive-request", label: "Archive Request", color: "#2563eb" },
  { id: "archived", label: "Archived", color: "#7c3aed" },
]);

const STATUS_IDS = new Set(SUBMISSION_STATUS_SERIES.map((series) => series.id));

export function normalizeAnalyticsStatus(value) {
  const normalized = String(value ?? "pending").trim().toLowerCase().replaceAll("_", "-");
  if (["accepted", "approved", "addressed"].includes(normalized)) return "accepted";
  if (normalized === "rejected") return "rejected";
  if (["archive-request", "archive-requested"].includes(normalized)) return "archive-request";
  if (["archived", "archive", "achived"].includes(normalized)) return "archived";
  return "pending";
}

function emptyStatusRecord(seed = {}) {
  return SUBMISSION_STATUS_SERIES.reduce(
    (record, series) => ({ ...record, [series.id]: 0 }),
    { ...seed },
  );
}

export function buildSubmissionStatusTotals(submissions = []) {
  return (submissions ?? []).reduce((totals, submission) => {
    const status = normalizeAnalyticsStatus(submission.status);
    if (STATUS_IDS.has(status)) totals[status] += 1;
    return totals;
  }, emptyStatusRecord());
}

export function buildSubmissionStatusTimeline(submissions = []) {
  const buckets = new Map();
  (submissions ?? []).forEach((submission) => {
    const timestamp = new Date(submission.created_at ?? submission.submittedAt ?? "");
    if (Number.isNaN(timestamp.getTime())) return;
    const date = timestamp.toISOString().slice(0, 10);
    if (!buckets.has(date)) buckets.set(date, emptyStatusRecord({ date }));
    buckets.get(date)[normalizeAnalyticsStatus(submission.status)] += 1;
  });
  return [...buckets.values()].sort((left, right) => left.date.localeCompare(right.date));
}
