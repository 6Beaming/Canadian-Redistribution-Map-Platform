async function handleResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = body.code ?? null;
    throw error;
  }
  return body;
}

export async function getArchiveRequest(submissionId) {
  const response = await fetch(
    `/api/workspace/archive-requests/${encodeURIComponent(submissionId)}`,
    { method: "GET", credentials: "include" },
  );
  return handleResponse(response);
}

export async function createArchiveRequest(submissionId, assignees, { expectedVersion } = {}) {
  const response = await fetch("/api/workspace/archive-requests", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submissionId,
      assignees,
      ...(expectedVersion === undefined || expectedVersion === null
        ? {}
        : { expectedVersion }),
    }),
  });
  return handleResponse(response);
}

export async function updateArchiveRequestAssignees(requestId, assignees, { expectedVersion } = {}) {
  const response = await fetch(
    `/api/workspace/archive-requests/${encodeURIComponent(requestId)}/assignees`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignees, expectedVersion }),
    },
  );
  return handleResponse(response);
}

export async function voteArchiveRequest(requestId, vote, { expectedVersion } = {}) {
  const response = await fetch(
    `/api/workspace/archive-requests/${encodeURIComponent(requestId)}/votes`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote, expectedVersion }),
    },
  );
  return handleResponse(response);
}

export async function cancelArchiveRequest(requestId, { expectedVersion } = {}) {
  const response = await fetch(
    `/api/workspace/archive-requests/${encodeURIComponent(requestId)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion }),
    },
  );
  return handleResponse(response);
}
