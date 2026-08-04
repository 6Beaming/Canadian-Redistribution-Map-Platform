import {
  authorizeSubmissionScope,
  claimSubmissionForOperation,
  clearSubmissionClaim,
  notFoundScopeError,
} from "../authorization/resourceScopeGuard.js";
import { resolveCommissionerPruid } from "../authorization/provinceCatalog.js";
import * as repo from "./repository.js";

const OPEN = "open";
const APPROVED = "approved";
const REJECTED = "rejected";
const CANCELLED = "cancelled";
const CONSUMED = "consumed";

const TERMINAL = new Set([REJECTED, CANCELLED, CONSUMED]);

function archiveError(message, { statusCode = 400, code } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseExpectedVersion(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw archiveError("expectedVersion is required.", {
        statusCode: 400,
        code: "INVALID_EXPECTED_VERSION",
      });
    }
    return null;
  }
  const version = Number(value);
  if (!Number.isInteger(version) || version <= 0) {
    throw archiveError("expectedVersion must be a positive integer.", {
      statusCode: 400,
      code: "INVALID_EXPECTED_VERSION",
    });
  }
  return version;
}

function normalizeVote(value) {
  const vote = String(value ?? "").trim().toLowerCase();
  if (vote !== "accepted" && vote !== "rejected") {
    throw archiveError("vote must be accepted or rejected.", {
      statusCode: 400,
      code: "INVALID_VOTE",
    });
  }
  return vote;
}

async function writeOutbox(supabase, {
  aggregateId,
  operation,
  actorProfileId,
  ownerProfileId = null,
  eligibilityPruids,
  operatingPruid,
  resourceVersion,
  hints = {},
}) {
  const event = await repo.insertOutboxEvent(supabase, {
    aggregate_type: "workspace.archive_request",
    aggregate_id: String(aggregateId),
    operation,
    actor_profile_id: actorProfileId,
    owner_profile_id: ownerProfileId,
    scope_pruids: eligibilityPruids,
    operating_pruid: operatingPruid,
    resource_version: resourceVersion,
    projection_hints: {
      invalidate: [
        "workspace:list",
        `workspace:submission:${hints.submissionId ?? ""}`,
        `workspace:archive-request:${aggregateId}`,
      ],
      ...hints,
    },
  });

  await repo.insertScopeDelivery(supabase, {
    outboxId: event.id,
    pruid: operatingPruid,
  });

  return event;
}

async function sealSourceRevision(supabase, {
  submission,
  actorProfileId,
  eligibilityPruids,
}) {
  const type = String(submission.type ?? "").toLowerCase().replaceAll("_", "-");
  let revisionNumber = 1;
  let primaryDguid = submission.dguid;
  let secondaryDguid = submission.neighboring_dguid ?? null;
  let baselineRevision = null;
  let originalGeometry = null;
  let proposedGeometry = null;
  let sharedBoundary = null;
  let outerBoundary = null;
  let validationReport = {};
  let sourceCounterProposalRevisionId = null;

  if (type === "counter-proposal" || type === "counter_proposal") {
    const latest = await repo.loadLatestCounterProposalRevision(supabase, submission.id);
    if (!latest) {
      throw archiveError("Counter-Proposal revision is required before archiving.", {
        statusCode: 409,
        code: "SOURCE_REVISION_UNAVAILABLE",
      });
    }
    revisionNumber = latest.revision_number;
    primaryDguid = latest.primary_dguid;
    secondaryDguid = latest.secondary_dguid;
    baselineRevision = latest.baseline_revision;
    originalGeometry = latest.original_geometry;
    proposedGeometry = latest.proposed_geometry;
    sharedBoundary = latest.shared_boundary;
    outerBoundary = latest.outer_boundary;
    validationReport = latest.validation_report ?? {};
    sourceCounterProposalRevisionId = latest.id;
  }

  if (!primaryDguid) {
    throw archiveError("Submission is missing a primary DGUID for sealing.", {
      statusCode: 409,
      code: "SOURCE_REVISION_UNAVAILABLE",
    });
  }

  return repo.insertArchiveSourceRevision(supabase, {
    submission_id: submission.id,
    submission_type: type || "feedback",
    revision_number: revisionNumber,
    primary_dguid: primaryDguid,
    secondary_dguid: secondaryDguid,
    scope_pruids: eligibilityPruids,
    baseline_revision: baselineRevision,
    original_geometry: originalGeometry,
    proposed_geometry: proposedGeometry,
    shared_boundary: sharedBoundary,
    outer_boundary: outerBoundary,
    validation_report: validationReport,
    source_counter_proposal_revision_id: sourceCounterProposalRevisionId,
    created_by: actorProfileId,
  });
}

function deriveAllowedActions(request, votes, actor) {
  const actions = [];
  if (!request || !actor) return actions;
  const isRequester = String(request.requester_id) === String(actor.id);
  const isAssignee = (request.assignee_ids ?? []).some((id) => String(id) === String(actor.id));
  const state = request.state;

  if (state === OPEN) {
    if (isRequester) {
      actions.push("update-assignees", "cancel");
      if (canApproveFromVotes(request, votes)) actions.push("merge");
    }
    if (isAssignee || isRequester) actions.push("vote");
  }
  return actions;
}

function canApproveFromVotes(request, votes) {
  const assigneeIds = (request.assignee_ids ?? []).map(String);
  if (!assigneeIds.length) return false;
  const byVoter = new Map(votes.map((vote) => [String(vote.voter_id), vote.vote]));
  return assigneeIds.every((id) => byVoter.get(id) === "accepted");
}

export async function serializeArchiveRequestReadModel(supabase, request, {
  actorProfile,
  eligibilityPruids = null,
  crossProvinceWarning = null,
} = {}) {
  if (!request) return null;

  const votes = await repo.listVotes(supabase, request.id);
  const profileIds = [
    request.requester_id,
    ...(request.assignee_ids ?? []),
    ...votes.map((vote) => vote.voter_id),
  ];
  const profiles = await repo.loadProfilesByIds(supabase, profileIds);
  const byId = new Map(profiles.map((profile) => [String(profile.id), profile]));

  const requester = byId.get(String(request.requester_id));
  const assignees = (request.assignee_ids ?? [])
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((profile) => ({ id: profile.id, email: profile.email }));

  const voteProjections = votes.map((vote) => {
    const profile = byId.get(String(vote.voter_id));
    return {
      voterId: vote.voter_id,
      email: profile?.email ?? null,
      vote: vote.vote,
      updatedAt: vote.updated_at,
    };
  });

  const votesByEmail = Object.fromEntries(
    voteProjections
      .filter((vote) => vote.email)
      .map((vote) => [vote.email, vote.vote]),
  );

  return {
    id: request.id,
    submissionId: request.submission_id,
    eligibilityPruids: eligibilityPruids ?? [],
    operatingPruid: request.operating_pruid,
    crossProvinceWarning: crossProvinceWarning ?? null,
    sourceRevisionId: request.source_revision_id,
    state: request.state,
    version: Number(request.resource_version) || 1,
    requester: requester
      ? { id: requester.id, email: requester.email }
      : null,
    assignees,
    votes: voteProjections,
    allowedActions: deriveAllowedActions(request, votes, actorProfile),
    createdAt: request.created_at,
    updatedAt: request.updated_at,
    requesterEmail: requester?.email ?? null,
    assigneeEmails: assignees.map((entry) => entry.email),
    votesByEmail,
  };
}

function presentForUi(readModel) {
  if (!readModel) return null;
  return {
    ...readModel,
    // WorkspaceReviewPanel expects assignees: string[] and votes: {email: vote}.
    assignees: readModel.assigneeEmails ?? readModel.assignees?.map((entry) => entry.email) ?? [],
    votes: readModel.votesByEmail ?? {},
  };
}

async function resolveSameProvinceAssignees(supabase, emails, operatingPruid) {
  const wanted = [...new Set((emails ?? [])
    .map((email) => String(email ?? "").trim())
    .filter(Boolean))];
  const profiles = await repo.loadCommissionerProfilesByEmails(supabase, wanted);

  const byEmail = new Map(
    profiles.map((profile) => [
      String(profile.email ?? "").trim().toLowerCase(),
      profile,
    ]),
  );

  const resolved = [];
  for (const email of wanted) {
    const profile = byEmail.get(email.toLowerCase());
    if (!profile) {
      throw archiveError("Every assignee must be an active Commissioner email.", {
        statusCode: 400,
        code: "INVALID_ASSIGNEES",
      });
    }
    const pruid = resolveCommissionerPruid(profile);
    if (pruid !== operatingPruid) {
      throw archiveError("Assignees must belong to the operating province.", {
        statusCode: 400,
        code: "CROSS_PROVINCE_ASSIGNEE",
      });
    }
    resolved.push(profile);
  }

  return resolved;
}

export async function getArchiveRequestForSubmission({
  submissionId,
  actorProfile,
}) {
  const supabase = repo.getArchiveRequestAdmin();
  const submission = await repo.loadSubmissionForArchive(supabase, submissionId);
  if (!submission) return null;

  let scope;
  try {
    scope = await authorizeSubmissionScope(supabase, {
      submission,
      commissionerProfile: actorProfile,
      requireClaim: false,
    });
  } catch (error) {
    if (error.code === "NOT_FOUND") return null;
    throw error;
  }

  const request = await repo.loadArchiveRequestBySubmissionId(supabase, submissionId);
  if (!request) return null;

  if (request.operating_pruid !== scope.operatingPruid
    && !scope.eligibilityPruids.includes(request.operating_pruid)) {
    // Eligible provinces may read; unrelated already 404'd above.
  }

  const readModel = await serializeArchiveRequestReadModel(supabase, request, {
    actorProfile,
    eligibilityPruids: scope.eligibilityPruids,
    crossProvinceWarning: scope.crossProvinceWarning,
  });
  return presentForUi(readModel);
}

export async function createArchiveRequest({
  submissionId,
  assigneeEmails,
  expectedVersion,
  actorUser,
  actorProfile,
}) {
  const supabase = repo.getArchiveRequestAdmin();
  const submission = await repo.loadSubmissionForArchive(supabase, submissionId);
  if (!submission) throw notFoundScopeError();

  const existing = await repo.loadArchiveRequestBySubmissionId(supabase, submissionId);
  if (existing && (existing.state === OPEN || existing.state === APPROVED)) {
    throw archiveError("An active Archive Request already exists for this submission.", {
      statusCode: 409,
      code: "ARCHIVE_REQUEST_EXISTS",
    });
  }

  const scope = await authorizeSubmissionScope(supabase, {
    submission,
    commissionerProfile: actorProfile,
    requireClaim: true,
  });

  const version = parseExpectedVersion(expectedVersion)
    ?? Number(submission.resource_version)
    ?? 1;

  if (version !== (Number(submission.resource_version) || 1)) {
    throw archiveError("The submission was updated by another Commissioner.", {
      statusCode: 409,
      code: "STALE_RESOURCE_VERSION",
    });
  }

  const assignees = await resolveSameProvinceAssignees(
    supabase,
    assigneeEmails,
    scope.operatingPruid,
  );
  if (!assignees.length) {
    throw archiveError("At least one same-province assignee is required.", {
      statusCode: 400,
      code: "INVALID_ASSIGNEES",
    });
  }

  await claimSubmissionForOperation(supabase, {
    submissionId,
    expectedVersion: version,
    operatingPruid: scope.operatingPruid,
    actorProfileId: actorUser.id,
    claimKind: "archive-request",
  });

  const sealed = await sealSourceRevision(supabase, {
    submission,
    actorProfileId: actorUser.id,
    eligibilityPruids: scope.eligibilityPruids,
  });

  const request = await repo.insertArchiveRequest(supabase, {
    submission_id: submissionId,
    requester_id: actorUser.id,
    operating_pruid: scope.operatingPruid,
    source_revision_id: sealed.id,
    state: OPEN,
    resource_version: 1,
    assignee_ids: assignees.map((profile) => profile.id),
  });

  await repo.upsertVote(supabase, {
    requestId: request.id,
    voterId: actorUser.id,
    vote: "accepted",
  });

  const updatedSubmission = await repo.updateSubmissionArchiveFields(supabase, {
    submissionId,
    expectedVersion: version,
    operatingPruid: scope.operatingPruid,
    values: {
      status: "archive-request",
      resource_version: version + 1,
      active_claim_pruid: scope.operatingPruid,
      active_claim_kind: "archive-request",
      active_claim_actor_id: actorUser.id,
      active_claim_at: new Date().toISOString(),
    },
  });

  if (!updatedSubmission) {
    throw archiveError("The submission was updated by another Commissioner.", {
      statusCode: 409,
      code: "STALE_RESOURCE_VERSION",
    });
  }

  await writeOutbox(supabase, {
    aggregateId: request.id,
    operation: "create",
    actorProfileId: actorUser.id,
    eligibilityPruids: scope.eligibilityPruids,
    operatingPruid: scope.operatingPruid,
    resourceVersion: 1,
    hints: { submissionId, state: OPEN },
  });

  const readModel = await serializeArchiveRequestReadModel(supabase, request, {
    actorProfile,
    eligibilityPruids: scope.eligibilityPruids,
    crossProvinceWarning: scope.crossProvinceWarning,
  });
  return presentForUi(readModel);
}

export async function updateArchiveRequestAssignees({
  requestId,
  assigneeEmails,
  expectedVersion,
  actorUser,
  actorProfile,
}) {
  const supabase = repo.getArchiveRequestAdmin();
  const request = await repo.loadArchiveRequestById(supabase, requestId);
  if (!request) throw notFoundScopeError();

  const submission = await repo.loadSubmissionForArchive(supabase, request.submission_id);
  const scope = await authorizeSubmissionScope(supabase, {
    submission,
    commissionerProfile: actorProfile,
    requireClaim: false,
  });

  if (String(request.requester_id) !== String(actorUser.id)) {
    throw archiveError("Only the requester can update assignees.", {
      statusCode: 403,
      code: "FORBIDDEN",
    });
  }
  if (request.state !== OPEN) {
    throw archiveError("Assignees can only be changed while the request is open.", {
      statusCode: 409,
      code: "ILLEGAL_STATE_TRANSITION",
    });
  }
  if (request.operating_pruid !== scope.operatingPruid) {
    throw archiveError("Only the operating province can mutate this Archive Request.", {
      statusCode: 409,
      code: "RESOURCE_ALREADY_CLAIMED",
    });
  }

  const currentVersion = parseExpectedVersion(expectedVersion, { required: true });
  if (currentVersion !== Number(request.resource_version)) {
    throw archiveError("The Archive Request was updated by another Commissioner.", {
      statusCode: 409,
      code: "STALE_RESOURCE_VERSION",
    });
  }

  const assignees = await resolveSameProvinceAssignees(
    supabase,
    assigneeEmails,
    scope.operatingPruid,
  );
  if (!assignees.length) {
    throw archiveError("At least one same-province assignee is required.", {
      statusCode: 400,
      code: "INVALID_ASSIGNEES",
    });
  }

  const keepVoterIds = [request.requester_id, ...assignees.map((profile) => profile.id)];
  await repo.deleteVotesNotIn(supabase, request.id, keepVoterIds);

  const updated = await repo.updateArchiveRequest(supabase, request.id, currentVersion, {
    assignee_ids: assignees.map((profile) => profile.id),
    resource_version: currentVersion + 1,
  });
  if (!updated) {
    throw archiveError("The Archive Request was updated by another Commissioner.", {
      statusCode: 409,
      code: "STALE_RESOURCE_VERSION",
    });
  }

  await writeOutbox(supabase, {
    aggregateId: updated.id,
    operation: "update",
    actorProfileId: actorUser.id,
    eligibilityPruids: scope.eligibilityPruids,
    operatingPruid: scope.operatingPruid,
    resourceVersion: updated.resource_version,
    hints: { submissionId: updated.submission_id, state: updated.state },
  });

  const readModel = await serializeArchiveRequestReadModel(supabase, updated, {
    actorProfile,
    eligibilityPruids: scope.eligibilityPruids,
    crossProvinceWarning: scope.crossProvinceWarning,
  });
  return presentForUi(readModel);
}

export async function castArchiveRequestVote({
  requestId,
  vote,
  expectedVersion,
  actorUser,
  actorProfile,
}) {
  const supabase = repo.getArchiveRequestAdmin();
  const request = await repo.loadArchiveRequestById(supabase, requestId);
  if (!request) throw notFoundScopeError();

  const submission = await repo.loadSubmissionForArchive(supabase, request.submission_id);
  const scope = await authorizeSubmissionScope(supabase, {
    submission,
    commissionerProfile: actorProfile,
    requireClaim: false,
  });

  if (request.operating_pruid !== scope.operatingPruid) {
    throw archiveError("Only the operating province can mutate this Archive Request.", {
      statusCode: 409,
      code: "RESOURCE_ALREADY_CLAIMED",
    });
  }
  if (request.state !== OPEN) {
    throw archiveError("Votes are only accepted while the request is open.", {
      statusCode: 409,
      code: "ILLEGAL_STATE_TRANSITION",
    });
  }

  const isRequester = String(request.requester_id) === String(actorUser.id);
  const isAssignee = (request.assignee_ids ?? []).some((id) => String(id) === String(actorUser.id));
  if (!isRequester && !isAssignee) {
    throw archiveError("Only assignees in the operating province may vote.", {
      statusCode: 403,
      code: "FORBIDDEN",
    });
  }

  const currentVersion = parseExpectedVersion(expectedVersion, { required: true });
  if (currentVersion !== Number(request.resource_version)) {
    throw archiveError("The Archive Request was updated by another Commissioner.", {
      statusCode: 409,
      code: "STALE_RESOURCE_VERSION",
    });
  }

  const normalizedVote = normalizeVote(vote);
  await repo.upsertVote(supabase, {
    requestId: request.id,
    voterId: actorUser.id,
    vote: normalizedVote,
  });

  const votes = await repo.listVotes(supabase, request.id);
  let nextState = OPEN;
  if (normalizedVote === "rejected" && isAssignee) {
    nextState = REJECTED;
  } else if (canApproveFromVotes({ ...request }, votes)) {
    nextState = APPROVED;
  }

  const updated = await repo.updateArchiveRequest(supabase, request.id, currentVersion, {
    state: nextState,
    resource_version: currentVersion + 1,
  });
  if (!updated) {
    throw archiveError("The Archive Request was updated by another Commissioner.", {
      statusCode: 409,
      code: "STALE_RESOURCE_VERSION",
    });
  }

  if (nextState === REJECTED) {
    await clearSubmissionClaim(supabase, {
      submissionId: request.submission_id,
      expectedClaimPruid: scope.operatingPruid,
    });
    await repo.updateSubmissionArchiveFields(supabase, {
      submissionId: request.submission_id,
      values: {
        status: "accepted",
        resource_version: (Number(submission.resource_version) || 1) + 1,
        active_claim_pruid: null,
        active_claim_kind: null,
        active_claim_actor_id: null,
        active_claim_at: null,
      },
    });
  }

  await writeOutbox(supabase, {
    aggregateId: updated.id,
    operation: "update",
    actorProfileId: actorUser.id,
    eligibilityPruids: scope.eligibilityPruids,
    operatingPruid: scope.operatingPruid,
    resourceVersion: updated.resource_version,
    hints: { submissionId: updated.submission_id, state: updated.state },
  });

  const readModel = await serializeArchiveRequestReadModel(supabase, updated, {
    actorProfile,
    eligibilityPruids: scope.eligibilityPruids,
    crossProvinceWarning: scope.crossProvinceWarning,
  });
  return presentForUi(readModel);
}

export async function cancelArchiveRequest({
  requestId,
  expectedVersion,
  actorUser,
  actorProfile,
}) {
  const supabase = repo.getArchiveRequestAdmin();
  const request = await repo.loadArchiveRequestById(supabase, requestId);
  if (!request) throw notFoundScopeError();

  const submission = await repo.loadSubmissionForArchive(supabase, request.submission_id);
  const scope = await authorizeSubmissionScope(supabase, {
    submission,
    commissionerProfile: actorProfile,
    requireClaim: false,
  });

  if (String(request.requester_id) !== String(actorUser.id)) {
    throw archiveError("Only the requester can cancel this Archive Request.", {
      statusCode: 403,
      code: "FORBIDDEN",
    });
  }
  if (request.state !== OPEN && request.state !== APPROVED) {
    throw archiveError("Only open or approved Archive Requests can be cancelled.", {
      statusCode: 409,
      code: "ILLEGAL_STATE_TRANSITION",
    });
  }
  if (request.operating_pruid !== scope.operatingPruid) {
    throw archiveError("Only the operating province can mutate this Archive Request.", {
      statusCode: 409,
      code: "RESOURCE_ALREADY_CLAIMED",
    });
  }

  const currentVersion = parseExpectedVersion(expectedVersion, { required: true });
  if (currentVersion !== Number(request.resource_version)) {
    throw archiveError("The Archive Request was updated by another Commissioner.", {
      statusCode: 409,
      code: "STALE_RESOURCE_VERSION",
    });
  }

  const updated = await repo.updateArchiveRequest(supabase, request.id, currentVersion, {
    state: CANCELLED,
    resource_version: currentVersion + 1,
  });
  if (!updated) {
    throw archiveError("The Archive Request was updated by another Commissioner.", {
      statusCode: 409,
      code: "STALE_RESOURCE_VERSION",
    });
  }

  await clearSubmissionClaim(supabase, {
    submissionId: request.submission_id,
    expectedClaimPruid: scope.operatingPruid,
  });
  await repo.updateSubmissionArchiveFields(supabase, {
    submissionId: request.submission_id,
    values: {
      status: "accepted",
      resource_version: (Number(submission.resource_version) || 1) + 1,
      active_claim_pruid: null,
      active_claim_kind: null,
      active_claim_actor_id: null,
      active_claim_at: null,
    },
  });

  await writeOutbox(supabase, {
    aggregateId: updated.id,
    operation: "update",
    actorProfileId: actorUser.id,
    eligibilityPruids: scope.eligibilityPruids,
    operatingPruid: scope.operatingPruid,
    resourceVersion: updated.resource_version,
    hints: { submissionId: updated.submission_id, state: CANCELLED },
  });

  const readModel = await serializeArchiveRequestReadModel(supabase, updated, {
    actorProfile,
    eligibilityPruids: scope.eligibilityPruids,
    crossProvinceWarning: scope.crossProvinceWarning,
  });
  return presentForUi(readModel);
}
