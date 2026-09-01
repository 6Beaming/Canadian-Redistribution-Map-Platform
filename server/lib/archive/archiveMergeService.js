import { authorizeSubmissionScope } from "../authorization/resourceScopeGuard.js";
import { loadArchiveRequestById } from "../archiveRequests/repository.js";
import { archiveError } from "./archiveErrors.js";
import {
  buildArchiveBranchKey,
  buildCounterProposalDeletePayload,
  buildCounterProposalMergePayload,
  buildCounterProposalRevertPayload,
  normalizeArchiveSubmissionType,
} from "./archiveMaterializer.js";
import {
  assertArchiveMergeApproved,
  assertCounterProposalGeometryReady,
  assertExpectedBranchVersion,
  validateCounterProposalDigests,
} from "./archiveTransitionValidator.js";
import { loadCurrentCanonicalRelease } from "../map/canonicalReleaseStore.js";

function buildSubmissionProjection(submission, sourceRevision) {
  return {
    id: submission.id,
    type: submission.type,
    title: submission.title ?? "",
    comment: submission.comment ?? "",
    user_id: submission.user_id,
    dguid: sourceRevision?.primary_dguid ?? submission.dguid,
    neighboring_dguid: sourceRevision?.secondary_dguid ?? submission.neighboring_dguid ?? null,
    created_at: submission.created_at,
    updated_at: submission.updated_at,
  };
}

async function loadScopePruids(supabase, submissionId) {
  const { data, error } = await supabase
    .from("submission_scope_pruids")
    .select("pruid")
    .eq("submission_id", submissionId);
  if (error) {
    throw archiveError(error.message || "Unable to load submission scope.", {
      code: "ARCHIVE_SCOPE_LOOKUP_FAILED",
    });
  }
  return [...new Set((data ?? []).map((row) => String(row.pruid)).filter(Boolean))].sort();
}

async function loadSourceRevision(supabase, sourceRevisionId) {
  const { data, error } = await supabase
    .from("archive_source_revisions")
    .select("*")
    .eq("id", sourceRevisionId)
    .maybeSingle();
  if (error || !data) {
    throw archiveError("Sealed archive source revision is missing.", {
      statusCode: 409,
      code: "ARCHIVE_SOURCE_MISSING",
    });
  }
  return data;
}

async function loadGeometryRevisionBundle(supabase, submissionId) {
  const { data: revision, error } = await supabase
    .from("submission_geometry_revisions")
    .select("*")
    .eq("submission_id", submissionId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw archiveError(error.message || "Unable to load geometry revision.", {
      code: "ARCHIVE_GEOMETRY_LOOKUP_FAILED",
    });
  }
  if (!revision) return { revision: null, operations: [] };
  const { data: operations, error: operationError } = await supabase
    .from("submission_geometry_operations")
    .select("*")
    .eq("revision_id", revision.id)
    .order("operation_index", { ascending: true });
  if (operationError) {
    throw archiveError(operationError.message || "Unable to load geometry operations.", {
      code: "ARCHIVE_GEOMETRY_LOOKUP_FAILED",
    });
  }
  return { revision, operations: operations ?? [] };
}

async function authorizeArchivedSubmission(supabase, submissionId, actorProfile) {
  const { data: submission, error } = await supabase
    .from("submissions")
    .select("id,type,status,dguid,neighboring_dguid,user_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (error || !submission) {
    throw archiveError("The archived source submission was not found.", {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  }
  await authorizeSubmissionScope(supabase, {
    submission,
    commissionerProfile: actorProfile,
    requireClaim: false,
  });
  return submission;
}

export async function mergeApprovedArchiveRequest(supabase, {
  archiveRequestId,
  closingComment,
  actorUser,
  actorProfile,
}) {
  const request = await loadArchiveRequestById(supabase, archiveRequestId);
  assertArchiveMergeApproved(request);

  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("id,type,status,dguid,neighboring_dguid,user_id,title,comment,created_at,updated_at")
    .eq("id", request.submission_id)
    .maybeSingle();
  if (submissionError || !submission) {
    throw archiveError("Submission was not found.", { statusCode: 404, code: "NOT_FOUND" });
  }

  await authorizeSubmissionScope(supabase, {
    submission,
    commissionerProfile: actorProfile,
    requireClaim: false,
  });

  const sourceRevision = await loadSourceRevision(supabase, request.source_revision_id);
  const release = loadCurrentCanonicalRelease();
  const submissionType = normalizeArchiveSubmissionType(sourceRevision.submission_type ?? submission.type);
  const primaryDguid = sourceRevision.primary_dguid ?? submission.dguid;
  const secondaryDguid = sourceRevision.secondary_dguid ?? submission.neighboring_dguid ?? null;
  const scopePruids = await loadScopePruids(supabase, submission.id);
  const branchKey = buildArchiveBranchKey(submissionType, release.manifest.releaseId, primaryDguid, secondaryDguid);

  const payload = {
    branchKey,
    submissionType,
    releaseId: release.manifest.releaseId,
    primaryDguid,
    secondaryDguid,
    scopePruids,
    submissionProjection: buildSubmissionProjection(submission, sourceRevision),
    sourceGeometryRevisionId: sourceRevision.source_geometry_revision_id ?? null,
  };

  if (submissionType === "counter_proposal") {
    const { revision, operations } = await loadGeometryRevisionBundle(supabase, submission.id);
    assertCounterProposalGeometryReady(revision);
    if (revision.release_id !== release.manifest.releaseId) {
      throw archiveError("Counter-Proposal geometry belongs to a different immutable map release.", {
        statusCode: 409,
        code: "ARCHIVE_SOURCE_RELEASE_MISMATCH",
      });
    }
    payload.counterProposal = await buildCounterProposalMergePayload(supabase, {
      releaseId: release.manifest.releaseId,
      primaryDguid: revision.primary_dguid,
      secondaryDguid: revision.secondary_dguid,
      branchKey,
      geometryRevision: revision,
      operations,
    });
    validateCounterProposalDigests(payload.counterProposal);
    payload.sourceGeometryRevisionId = revision.id;
  }

  const { data, error } = await supabase.rpc("commit_archive_merge_v2", {
    p_archive_request_id: archiveRequestId,
    p_merged_by: actorUser.id,
    p_closing_comment: closingComment ?? null,
    p_payload: payload,
  });
  if (error) {
    throw archiveError(error.message || "Unable to merge into archive v2.", {
      statusCode: error.code === "P0001" ? 409 : 500,
      code: error.message?.includes("ARCHIVE") ? error.message : "ARCHIVE_MERGE_FAILED",
    });
  }
  return data;
}

export async function revertArchiveVersion(supabase, {
  versionId,
  actorUser,
  actorProfile,
  expectedBranchVersion,
  expectedMapRevision = null,
}) {
  const { data: version, error: versionError } = await supabase
    .from("archive_versions")
    .select("*, archive_branches(*)")
    .eq("id", versionId)
    .maybeSingle();
  if (versionError || !version) {
    throw archiveError("Archive version was not found.", {
      statusCode: 404,
      code: "ARCHIVE_VERSION_NOT_FOUND",
    });
  }

  const branch = version.archive_branches;
  assertExpectedBranchVersion(branch, expectedBranchVersion);
  await authorizeArchivedSubmission(supabase, version.source_submission_id, actorProfile);

  let payload = {};
  if (branch.submission_type === "counter_proposal") {
    const targetSnapshot = version.branch_vertex_snapshot;
    payload.counterProposal = await buildCounterProposalRevertPayload(supabase, {
      releaseId: branch.release_id,
      primaryDguid: branch.primary_dguid,
      secondaryDguid: branch.secondary_dguid,
      branchId: branch.id,
      branchKey: branch.branch_key,
      targetVertexSnapshot: targetSnapshot,
    });
    validateCounterProposalDigests(payload.counterProposal);
    expectedMapRevision ??= payload.counterProposal.expectedMapRevision;
  }

  const { data, error } = await supabase.rpc("revert_archive_version_v2", {
    p_version_id: versionId,
    p_merged_by: actorUser.id,
    p_expected_branch_version: expectedBranchVersion,
    p_expected_map_revision: expectedMapRevision,
    p_payload: payload,
  });
  if (error) {
    throw archiveError(error.message || "Unable to revert archive version.", {
      statusCode: 409,
      code: error.message?.includes("STALE_ARCHIVE_MAP")
        ? "STALE_ARCHIVE_MAP"
        : error.message?.includes("STALE_ARCHIVE_BRANCH")
          ? "STALE_ARCHIVE_BRANCH"
          : "ARCHIVE_REVERT_FAILED",
    });
  }
  return data;
}

export async function reinitializeArchiveBranch(supabase, {
  branchId,
  actorUser,
  actorProfile,
  expectedBranchVersion,
}) {
  const { data: branch, error: branchError } = await supabase
    .from("archive_branches")
    .select("*")
    .eq("id", branchId)
    .maybeSingle();
  if (branchError || !branch) {
    throw archiveError("Archive branch was not found.", {
      statusCode: 404,
      code: "ARCHIVE_BRANCH_NOT_FOUND",
    });
  }
  assertExpectedBranchVersion(branch, expectedBranchVersion);

  const { data: sourceVersion, error: sourceVersionError } = await supabase
    .from("archive_versions")
    .select("source_submission_id")
    .eq("branch_id", branch.id)
    .not("source_submission_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (sourceVersionError || !sourceVersion?.source_submission_id) {
    throw archiveError("Archive branch has no source submission.", {
      statusCode: 409,
      code: "ARCHIVE_SOURCE_MISSING",
    });
  }
  await authorizeArchivedSubmission(supabase, sourceVersion.source_submission_id, actorProfile);

  let payload = {};
  if (branch.submission_type === "counter_proposal") {
    payload.counterProposal = await buildCounterProposalDeletePayload(supabase, {
      releaseId: branch.release_id,
      primaryDguid: branch.primary_dguid,
      secondaryDguid: branch.secondary_dguid,
      branchId: branch.id,
      branchKey: branch.branch_key,
    });
    validateCounterProposalDigests(payload.counterProposal);
  }

  const { data, error } = await supabase.rpc("reinitialize_archive_branch_v2", {
    p_branch_id: branchId,
    p_actor: actorUser.id,
    p_expected_branch_version: expectedBranchVersion,
    p_payload: payload,
  });
  if (error) {
    throw archiveError(error.message || "Unable to reinitialize archive branch.", {
      statusCode: 409,
      code: error.message?.includes("STALE_ARCHIVE_MAP")
        ? "STALE_ARCHIVE_MAP"
        : error.message?.includes("STALE_ARCHIVE_BRANCH")
          ? "STALE_ARCHIVE_BRANCH"
          : "ARCHIVE_DELETE_FAILED",
    });
  }
  return data;
}
