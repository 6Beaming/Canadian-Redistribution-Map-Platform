export const WORKSPACE_LIST_INVALIDATION_KEYS = Object.freeze([
  "workspace:submission:*",
  "workspace:branch:*",
]);

export const COMMISSIONER_TABLE_INVALIDATION_KEYS = Object.freeze([
  "commissioner-table:submission:*",
]);

const WORKSPACE_REVIEW_KEY_BUILDERS = Object.freeze({
  archiveRequest: (submissionId) => `workspace:archive-request:${submissionId}`,
  comments: (submissionId) => `workspace:comments:${submissionId}`,
  labelCatalog: (submissionId) => `workspace:custom-labels:${submissionId}`,
  labels: (submissionId) => `workspace:labels:${submissionId}`,
  status: (submissionId) => `workspace:status:${submissionId}`,
});

const SUBMISSION_INVALIDATION_PREFIXES = Object.freeze([
  "workspace:submission:",
  "workspace:branch:",
  "commissioner-table:submission:",
]);

export function getRealtimeSubmissionId({ event, hints = [] } = {}) {
  for (const hint of hints) {
    const prefix = SUBMISSION_INVALIDATION_PREFIXES.find((candidate) => hint.startsWith(candidate));
    if (prefix) return hint.slice(prefix.length);
  }
  return String(event?.aggregateId ?? "");
}

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

export function reconcileWorkspaceSubmission(current, event, submission, hints = []) {
  const submissionId = getRealtimeSubmissionId({ event, hints });
  if (!submissionId) return current;

  const remaining = current.filter((item) => String(item.id) !== submissionId);
  if (
    (event.entity === "submission" && event.operation === "delete")
    || !submission
    || submission.status === "archived"
  ) {
    return remaining;
  }

  return [...remaining, submission].sort(newestFirst);
}

export function reconcileCommissionerSubmissionRows(current, event, submission, hints = []) {
  const submissionId = getRealtimeSubmissionId({ event, hints });
  if (!submissionId) return current;

  const existingIndex = current.findIndex((item) => String(item.id) === submissionId);
  const isDelete = event?.entity === "submission" && event?.operation === "delete";
  if (isDelete || !submission) {
    return existingIndex < 0
      ? current
      : current.filter((item) => String(item.id) !== submissionId);
  }

  if (existingIndex >= 0) {
    return current.map((item, index) => index === existingIndex ? submission : item);
  }

  return [submission, ...current].sort((left, right) => (
    new Date(right.submittedAt) - new Date(left.submittedAt)
  ));
}

export function reconcileWorkspaceCustomLabels(selectedLabels, labelCatalog) {
  const customLabelsById = new Map(labelCatalog
    .filter((label) => label.custom)
    .map((label) => [String(label.id), label]));

  return selectedLabels.flatMap((label) => {
    if (!label.custom) return [label];
    const definition = customLabelsById.get(String(label.id));
    return definition ? [{ ...label, name: definition.name, color: definition.color }] : [];
  });
}
