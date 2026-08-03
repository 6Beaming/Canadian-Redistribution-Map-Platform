export const WORKSPACE_LIST_INVALIDATION_KEYS = Object.freeze([
  "workspace:submission:*",
  "workspace:branch:*",
]);

const WORKSPACE_REVIEW_KEY_BUILDERS = Object.freeze({
  comments: (submissionId) => `workspace:comments:${submissionId}`,
  labels: (submissionId) => `workspace:labels:${submissionId}`,
});

export function getWorkspaceReviewInvalidationKeys(submissionId) {
  return Object.freeze(Object.values(WORKSPACE_REVIEW_KEY_BUILDERS).map((buildKey) => (
    buildKey(String(submissionId))
  )));
}

export function getWorkspaceReviewInvalidationTargets(hints, submissionId) {
  const hintSet = new Set(hints);
  return Object.freeze(Object.entries(WORKSPACE_REVIEW_KEY_BUILDERS)
    .filter(([, buildKey]) => hintSet.has(buildKey(String(submissionId))))
    .map(([target]) => target));
}

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
