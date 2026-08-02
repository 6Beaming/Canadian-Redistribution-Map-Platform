export function normalizePublicSubmissionStatus(status) {
  const normalized = String(status ?? "").trim().toLowerCase().replaceAll(" ", "_");
  return normalized === "pending" ? "pending" : "processed";
}
