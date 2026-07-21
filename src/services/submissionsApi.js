async function parseJsonResponse(res) {
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(body.error || `Request failed (${res.status})`);
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
}) {
  const res = await fetch("/api/submissions/counter-proposals", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      comment,
      fed_num,
      dguid,
      neighboring_dguid,
      proposed_geometry,
    }),
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
