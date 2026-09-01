const ACTIVE_ARCHIVE_REQUEST_STATES = Object.freeze(["open", "approved"]);

function isArchiveRequestStatus(value) {
  return ["archive-request", "archive_request", "archive-requested"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

function actorCanSeeArchiveRequest(request, actorProfileId) {
  const actorId = String(actorProfileId ?? "");
  if (!actorId) return false;

  // requester_id remains a compatibility fallback for pre-invariant rows.
  return String(request?.requester_id ?? "") === actorId
    || (request?.assignee_ids ?? []).some((id) => String(id) === actorId);
}

export async function loadArchiveRequestVisibility(
  supabase,
  submissionIds,
  actorProfileId,
) {
  const ids = [...new Set((submissionIds ?? []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from("workspace_archive_requests")
    .select("id,submission_id,requester_id,assignee_ids,state,resource_version,created_at")
    .in("submission_id", ids)
    .in("state", ACTIVE_ARCHIVE_REQUEST_STATES)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const visibilityBySubmissionId = new Map();
  for (const request of data ?? []) {
    const submissionId = String(request.submission_id ?? "");
    if (!submissionId || visibilityBySubmissionId.has(submissionId)) continue;
    visibilityBySubmissionId.set(submissionId, {
      requestId: request.id,
      requestVersion: Number(request.resource_version) || 1,
      isAssignee: actorCanSeeArchiveRequest(request, actorProfileId),
    });
  }
  return visibilityBySubmissionId;
}

export async function projectArchiveRequestVisibility(supabase, rows, actorProfileId) {
  const candidates = (rows ?? []).filter((row) => isArchiveRequestStatus(row?.status));
  if (!candidates.length) return rows ?? [];

  const visibilityBySubmissionId = await loadArchiveRequestVisibility(
    supabase,
    candidates.map((row) => row.id),
    actorProfileId,
  );

  return (rows ?? []).map((row) => {
    if (!isArchiveRequestStatus(row?.status)) return row;
    const visibility = visibilityBySubmissionId.get(String(row.id));
    const isAssignee = visibility?.isAssignee === true;
    return {
      ...row,
      visible_status: isAssignee ? "archive-request" : "accepted",
      archive_request_assigned_to_viewer: isAssignee,
      archive_request_id: visibility?.requestId ?? null,
      archive_request_version: visibility?.requestVersion ?? null,
    };
  });
}

export function projectSingleArchiveRequestStatus(row, visibility) {
  if (!isArchiveRequestStatus(row?.status)) return row?.status;
  return visibility?.isAssignee === true ? "archive-request" : "accepted";
}
