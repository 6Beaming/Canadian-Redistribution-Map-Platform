export const WORKSPACE_LIST_INVALIDATION_KEYS = Object.freeze([
  "workspace:submission:*",
  "workspace:branch:*",
]);

function newestFirst(left, right) {
  return new Date(right.created_at) - new Date(left.created_at);
}

export function reconcileWorkspaceSubmission(current, event, submission) {
  const submissionId = String(event?.aggregateId ?? "");
  if (!submissionId) return current;

  const remaining = current.filter((item) => String(item.id) !== submissionId);
  if (
    event.operation === "delete"
    || !submission
    || submission.status === "archived"
  ) {
    return remaining;
  }

  return [...remaining, submission].sort(newestFirst);
}
