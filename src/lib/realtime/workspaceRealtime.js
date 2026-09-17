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

function newestCommissionerRowFirst(left, right) {
  return new Date(right.submittedAt) - new Date(left.submittedAt);
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
    newestCommissionerRowFirst(left, right)
  ));
}

export function reconcileCommissionerSubmissionView(
  current,
  event,
  submission,
  hints = [],
  { newSince = Number.NEGATIVE_INFINITY } = {},
) {
  const submissionId = getRealtimeSubmissionId({ event, hints });
  if (!submissionId) return current;

  const visibleRows = current?.visibleRows ?? [];
  const bufferedRows = current?.bufferedRows ?? [];
  const isDelete = event?.entity === "submission" && event?.operation === "delete";

  if (isDelete || !submission) {
    return {
      visibleRows: visibleRows.filter((item) => String(item.id) !== submissionId),
      bufferedRows: bufferedRows.filter((item) => String(item.id) !== submissionId),
    };
  }

  if (visibleRows.some((item) => String(item.id) === submissionId)) {
    return {
      visibleRows: visibleRows.map((item) => (
        String(item.id) === submissionId ? submission : item
      )),
      bufferedRows: bufferedRows.filter((item) => String(item.id) !== submissionId),
    };
  }

  const alreadyBuffered = bufferedRows.some((item) => String(item.id) === submissionId);
  const isNewCreation = event?.entity === "submission"
    && event?.operation === "create"
    && new Date(submission.submittedAt).getTime() >= newSince;
  if (!alreadyBuffered && !isNewCreation) return current;

  return {
    visibleRows,
    bufferedRows: [
      submission,
      ...bufferedRows.filter((item) => String(item.id) !== submissionId),
    ].sort(newestCommissionerRowFirst),
  };
}

// Exclude pending arrivals before slicing so refreshes and pagination cannot reveal them.
export function excludeBufferedCommissionerRows(rows, bufferedRows = []) {
  const bufferedIds = new Set(bufferedRows.map((row) => String(row.id)));
  return rows.filter((row) => !bufferedIds.has(String(row.id)));
}

export function reconcileCommissionerSubmissionSnapshot(current, submissions) {
  const visibleRows = current?.visibleRows ?? [];
  const bufferedRows = current?.bufferedRows ?? [];
  const rowsById = new Map();

  for (const submission of submissions ?? []) {
    const submissionId = String(submission?.id ?? "");
    if (submissionId) rowsById.set(submissionId, submission);
  }

  const knownIds = new Set(
    [...visibleRows, ...bufferedRows].map((submission) => String(submission.id)),
  );
  const refreshKnownRows = (rows) => rows.flatMap((submission) => {
    const refreshed = rowsById.get(String(submission.id));
    return refreshed ? [refreshed] : [];
  });
  const newlyDiscoveredRows = [...rowsById.entries()]
    .filter(([submissionId]) => !knownIds.has(submissionId))
    .map(([, submission]) => submission);

  return {
    visibleRows: refreshKnownRows(visibleRows),
    bufferedRows: [
      ...refreshKnownRows(bufferedRows),
      ...newlyDiscoveredRows,
    ].sort(newestCommissionerRowFirst),
  };
}

export function revealCommissionerSubmissionRows(current) {
  const visibleRows = current?.visibleRows ?? [];
  const bufferedRows = current?.bufferedRows ?? [];
  if (!bufferedRows.length) return current;

  const bufferedIds = new Set(bufferedRows.map((submission) => String(submission.id)));
  return {
    visibleRows: [
      ...bufferedRows.slice().sort(newestCommissionerRowFirst),
      ...visibleRows.filter((submission) => !bufferedIds.has(String(submission.id))),
    ],
    bufferedRows: [],
  };
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
