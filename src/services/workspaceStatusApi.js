async function handleResponse(response) {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = body.code ?? null;
    error.current = body.current ?? null;
    throw error;
  }

  return body;
}

export async function getWorkspaceSubmissionStatus(submissionId) {
  const response = await fetch(
    `/api/workspace/submissions/${encodeURIComponent(submissionId)}/status`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  return handleResponse(response);
}

export async function patchWorkspaceSubmissionStatus(
  submissionId,
  { status, expectedVersion } = {},
) {
  const response = await fetch(
    `/api/workspace/submissions/${encodeURIComponent(submissionId)}/status`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        ...(expectedVersion === undefined || expectedVersion === null
          ? {}
          : { expectedVersion }),
      }),
    },
  );

  return handleResponse(response);
}
