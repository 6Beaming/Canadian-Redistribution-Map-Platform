import { archiveError } from "./archiveErrors.js";

export function assertArchiveMergeApproved(request) {
  if (!request) {
    throw archiveError("Archive request was not found.", {
      statusCode: 404,
      code: "ARCHIVE_REQUEST_NOT_FOUND",
    });
  }
  if (request.state !== "approved") {
    throw archiveError("Archive request is not approved.", {
      statusCode: 409,
      code: "ARCHIVE_REQUEST_NOT_APPROVED",
    });
  }
}

export function assertExpectedBranchVersion(branch, expectedVersion) {
  if (!branch) {
    throw archiveError("Archive branch was not found.", {
      statusCode: 404,
      code: "ARCHIVE_BRANCH_NOT_FOUND",
    });
  }
  if (Number(branch.resource_version) !== Number(expectedVersion)) {
    throw archiveError("Archive branch version is stale.", {
      statusCode: 409,
      code: "STALE_ARCHIVE_BRANCH",
    });
  }
}

export function assertCounterProposalGeometryReady(revision) {
  if (!revision) {
    throw archiveError("Counter-Proposal geometry revision is missing.", {
      statusCode: 409,
      code: "ARCHIVE_SOURCE_MISSING",
    });
  }
  if (revision.migration_state !== "ready") {
    throw archiveError("Counter-Proposal geometry revision is not ready.", {
      statusCode: 409,
      code: "ARCHIVE_SOURCE_MISSING",
    });
  }
}

export function validateCounterProposalDigests(payload) {
  if (!payload?.geometryDigest || !String(payload.geometryDigest).startsWith("sha256:")) {
    throw archiveError("Counter-Proposal geometry digest is invalid.", {
      statusCode: 409,
      code: "ARCHIVE_GEOMETRY_CONFLICT",
    });
  }
  for (const dguid of payload.affectedDguids ?? []) {
    const digest = payload.afterDigests?.[dguid];
    if (!digest || !String(digest).startsWith("sha256:")) {
      throw archiveError(`Archived map digest is invalid for ${dguid}.`, {
        statusCode: 409,
        code: "ARCHIVE_GEOMETRY_CONFLICT",
      });
    }
  }
}
