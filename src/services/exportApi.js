async function downloadFile(url, fallbackFilename, requestOptions = {}) {
  const response = await fetch(url, { ...requestOptions, credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function exportCommissionerSubmissionsCsv(submissionIds) {
  return downloadFile("/api/exports/submissions.csv", "commissioner-submissions.csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionIds }),
  });
}

export function exportArchivedTreeJson() {
  return downloadFile("/api/exports/archive-tree.json", "archived-tree.json");
}
