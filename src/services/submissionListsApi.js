function appendFilters(url, filters = {}) {
  const params = new URLSearchParams();
  ["query", "createdFrom", "createdTo", "type", "status", "sort"].forEach((key) => {
    const value = String(filters[key] ?? "").trim();
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `${url}?${query}` : url;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { credentials: "include", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export async function getCommissionerSubmissionTableRows(filters = {}) {
  const payload = await requestJson(appendFilters("/api/submissions", filters));
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    appliedFilters: payload.appliedFilters ?? {},
  };
}

export async function getMySubmissionTableRows(filters = {}) {
  const payload = await requestJson(appendFilters("/api/submissions/mine", filters));
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    appliedFilters: payload.appliedFilters ?? {},
  };
}

export async function getSubmissionTableRowById(submissionId) {
  const payload = await requestJson(
    `/api/submissions/table-row/${encodeURIComponent(submissionId)}`,
  );
  return payload.item ?? null;
}
