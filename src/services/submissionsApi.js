async function parseJsonResponse(res) {
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(body.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = body.code ?? null;
    error.validationReport = body.validation_report ?? null;
    throw error;
  }

  return body;
}

export async function submitCounterProposal({
  title,
  comment,
  fed_num,
  dguid,
  neighboring_dguid,
  proposed_geometry,
  schemaVersion,
  releaseId,
  baseRevision,
  primaryDguid,
  secondaryDguid,
  operations,
  clientDiagnostics,
}) {
  const isV2 = schemaVersion === "2.0" || Array.isArray(operations);
  const body = isV2
    ? {
      schemaVersion: "2.0",
      title,
      comment,
      releaseId,
      baseRevision,
      primaryDguid: primaryDguid ?? dguid,
      secondaryDguid: secondaryDguid ?? neighboring_dguid,
      operations,
      ...(clientDiagnostics ? { clientDiagnostics } : {}),
    }
    : {
      title,
      comment,
      fed_num,
      dguid,
      neighboring_dguid,
      proposed_geometry,
    };

  const res = await fetch("/api/submissions/counter-proposals", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return parseJsonResponse(res);
}

export async function getCounterProposal(submissionId) {
  const res = await fetch(`/api/submissions/counter-proposals/${submissionId}`, {
    method: "GET",
    credentials: "include",
  });

  return parseJsonResponse(res);
}

export async function getCounterProposals() {
  const res = await fetch("/api/submissions/counter-proposals", {
    method: "GET",
    credentials: "include",
  });

  return parseJsonResponse(res);
}

export async function getSubmissionMaterializedGeometry(submissionId) {
  const res = await fetch(
    `/api/submissions/${encodeURIComponent(submissionId)}/geometry?materialize=1`,
    { credentials: "include" },
  );

  return parseJsonResponse(res);
}
