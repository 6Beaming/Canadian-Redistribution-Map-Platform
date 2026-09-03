import { archiveError } from "./archiveErrors.js";
import { getProfileForDguid } from "../map/mapAssetAuthority.js";
import { getArchiveMapRevisionSequence } from "./archivedMapRepository.js";

const ARCHIVE_VERSION_SUMMARY_COLUMNS = [
  "id",
  "branch_id",
  "version_number",
  "merge_sequence",
  "version_kind",
  "submission_projection",
  "geometry_digest",
  "validation_report",
  "closing_comment",
  "merged_by",
  "merged_at",
].join(",");

const ARCHIVE_VERSION_GEOMETRY_COLUMNS = [
  "display_geometry",
  "result_geometry",
  "branch_vertex_snapshot",
].join(",");

function normalizeSubmissionType(value) {
  const type = String(value ?? "comment").trim().toLowerCase().replaceAll("-", "_");
  if (["feedback", "comment", "comments"].includes(type)) return "comment";
  if (type === "objection") return "objection";
  if (["counterproposal", "counter_proposal"].includes(type)) return "counter_proposal";
  return "comment";
}

function mapLegacyTypeToSubmission(type) {
  if (type === "comment") return "feedback";
  if (type === "objection") return "objection";
  return "counter-proposal";
}

export function normalizeArchiveSubmissionProjection(projection, {
  authorEmail = null,
} = {}) {
  if (!projection || typeof projection !== "object") {
    return {};
  }
  const author = projection.author && typeof projection.author === "object"
    ? projection.author
    : null;
  const normalized = {
    ...projection,
    id: projection.id ?? projection.source_submission_id ?? null,
    user_id: projection.user_id ?? author?.id ?? null,
    created_at: projection.created_at ?? projection.submitted_at ?? null,
    title: projection.title ?? "",
    comment: projection.comment ?? "",
    dguid: projection.dguid ?? projection.primaryDguid ?? null,
    neighboring_dguid: projection.neighboring_dguid ?? projection.secondaryDguid ?? null,
  };
  const resolvedAuthorEmail = authorEmail
    ?? projection.authorEmail
    ?? author?.email
    ?? projection.profile?.email
    ?? null;
  if (resolvedAuthorEmail) {
    normalized.authorEmail = resolvedAuthorEmail;
    normalized.profile = { ...(projection.profile ?? {}), email: resolvedAuthorEmail };
  }
  return normalized;
}

function projectionToSubmission(projection, branch, emailsById = new Map()) {
  const normalized = normalizeArchiveSubmissionProjection(projection, {
    authorEmail: emailsById.get(projection?.user_id ?? projection?.author?.id)
      ?? projection?.authorEmail
      ?? projection?.profile?.email
      ?? null,
  });
  const submission = {
    ...normalized,
    type: mapLegacyTypeToSubmission(branch?.submission_type ?? normalized?.type),
    dguid: branch?.primary_dguid ?? normalized.dguid ?? null,
    neighboring_dguid: branch?.secondary_dguid ?? normalized.neighboring_dguid ?? null,
    status: "archived",
  };
  return submission;
}

export function mapVersionRecord(branch, version, emailsById = new Map()) {
  const mergedBy = version.merged_by ?? null;
  return {
    branchId: branch.id,
    branchKey: branch.branch_key,
    releaseId: branch.release_id,
    submissionType: branch.submission_type,
    primaryDguid: branch.primary_dguid,
    secondaryDguid: branch.secondary_dguid ?? null,
    resourceVersion: Number(branch.resource_version) || 1,
    versionId: version.id,
    versionNumber: Number(version.version_number) || null,
    versionKind: version.version_kind,
    mergeSequence: Number(version.merge_sequence) || null,
    isLatest: branch.head_version_id === version.id,
    geometryDigest: version.geometry_digest ?? null,
    hasGeometry: Boolean(version.geometry_digest),
    submission: projectionToSubmission(version.submission_projection, branch, emailsById),
    mergedBy: emailsById.get(mergedBy) ?? mergedBy ?? "Unknown commissioner",
    mergedAt: version.merged_at,
    closingComment: version.closing_comment ?? null,
    validationReport: version.validation_report ?? null,
    revertedAt: null,
    revertedBy: null,
  };
}

export function mapLegacyArchiveRecord(
  record,
  emailsById = new Map(),
  validationReportsBySubmissionId = new Map(),
) {
  const submission = projectionToSubmission(record.submission_snapshot, {
    submission_type: normalizeSubmissionType(record.submission_snapshot?.type),
    primary_dguid: record.submission_snapshot?.dguid ?? null,
    secondary_dguid: record.submission_snapshot?.neighboring_dguid ?? null,
  }, emailsById);
  return {
    branchId: null,
    branchKey: record.branch_key ?? null,
    releaseId: null,
    submissionType: normalizeSubmissionType(record.submission_snapshot?.type),
    primaryDguid: record.submission_snapshot?.dguid ?? null,
    secondaryDguid: record.submission_snapshot?.neighboring_dguid ?? null,
    resourceVersion: 1,
    versionId: record.id ?? null,
    versionNumber: Number(record.version_number) || null,
    versionKind: record.reverted_at ? "revert" : "merge",
    mergeSequence: null,
    isLatest: Boolean(record.is_latest),
    geometryDigest: null,
    hasGeometry: Boolean(record.submission_snapshot?.geometry),
    submission,
    mergedBy: emailsById.get(record.merged_by) ?? record.merged_by_email ?? record.merged_by ?? "Unknown commissioner",
    mergedAt: record.merged_at,
    closingComment: record.closing_comment ?? null,
    validationReport:
      validationReportsBySubmissionId.get(String(submission.id))
      ?? submission.validation_report
      ?? null,
    revertedAt: record.reverted_at ?? null,
    revertedBy: emailsById.get(record.reverted_by) ?? record.reverted_by_email ?? record.reverted_by ?? null,
  };
}

async function loadCounterProposalValidationReports(supabase, submissionIds) {
  const uniqueIds = [...new Set((submissionIds ?? []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("submission_geometry_revisions")
    .select("submission_id,revision_number,validation_report")
    .in("submission_id", uniqueIds)
    .eq("submission_type", "counter_proposal")
    .order("revision_number", { ascending: false });
  if (error) {
    throw archiveError(error.message || "Unable to load archived Counter-Proposal impact.", {
      code: "ARCHIVE_IMPACT_READ_FAILED",
    });
  }
  const reports = new Map();
  for (const revision of data ?? []) {
    const submissionId = String(revision.submission_id ?? "");
    if (submissionId && !reports.has(submissionId)) {
      reports.set(submissionId, revision.validation_report ?? null);
    }
  }
  return reports;
}

async function loadProfileEmails(supabase, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email")
    .in("id", uniqueIds);
  if (error) {
    throw archiveError(error.message || "Unable to load archive profile emails.", {
      code: "ARCHIVE_PROFILES_FAILED",
    });
  }
  return new Map((data ?? []).map((profile) => [profile.id, profile.email]));
}

async function listV2ArchiveRecords(supabase) {
  const { data: branches, error: branchError } = await supabase
    .from("archive_branches")
    .select("id, branch_key, submission_type, release_id, primary_dguid, secondary_dguid, head_version_id, head_version_number, resource_version, scope_pruids, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (branchError) {
    throw archiveError(branchError.message || "Unable to load archive branches.", {
      code: "ARCHIVE_BRANCH_READ_FAILED",
    });
  }
  if (!branches?.length) return [];

  const branchIds = branches.map((branch) => branch.id);
  const { data: versions, error: versionError } = await supabase
    .from("archive_versions")
    .select(ARCHIVE_VERSION_SUMMARY_COLUMNS)
    .in("branch_id", branchIds)
    .order("version_number", { ascending: false });
  if (versionError) {
    throw archiveError(versionError.message || "Unable to load archive versions.", {
      code: "ARCHIVE_VERSION_READ_FAILED",
    });
  }

  const emailsById = await loadProfileEmails(
    supabase,
    (versions ?? []).flatMap((version) => [
      version.merged_by,
      version.submission_projection?.user_id,
    ]),
  );
  const branchesById = new Map(branches.map((branch) => [branch.id, branch]));
  return (versions ?? []).map((version) => mapVersionRecord(
    branchesById.get(version.branch_id),
    version,
    emailsById,
  ));
}

export async function listArchiveTreeRecords(supabase) {
  const v2Records = await listV2ArchiveRecords(supabase);
  return { source: "v2", records: v2Records };
}

export async function getArchiveBranch(supabase, branchId) {
  const { data: branch, error } = await supabase
    .from("archive_branches")
    .select("id, branch_key, submission_type, release_id, primary_dguid, secondary_dguid, head_version_id, head_version_number, resource_version, scope_pruids, created_at, updated_at")
    .eq("id", branchId)
    .maybeSingle();
  if (error) {
    throw archiveError(error.message || "Unable to load archive branch.", {
      code: "ARCHIVE_BRANCH_READ_FAILED",
    });
  }
  if (!branch) {
    throw archiveError("Archive branch was not found.", {
      statusCode: 404,
      code: "ARCHIVE_BRANCH_NOT_FOUND",
    });
  }

  const { data: versions, error: versionError } = await supabase
    .from("archive_versions")
    .select(ARCHIVE_VERSION_SUMMARY_COLUMNS)
    .eq("branch_id", branchId)
    .order("version_number", { ascending: false });
  if (versionError) {
    throw archiveError(versionError.message || "Unable to load archive branch versions.", {
      code: "ARCHIVE_VERSION_READ_FAILED",
    });
  }

  const emailsById = await loadProfileEmails(
    supabase,
    (versions ?? []).flatMap((version) => [
      version.merged_by,
      version.submission_projection?.user_id,
    ]),
  );
  return {
    branch,
    versions: (versions ?? []).map((version) => mapVersionRecord(branch, version, emailsById)),
  };
}

export async function getArchiveVersion(supabase, versionId, { includeGeometry = false } = {}) {
  const columns = includeGeometry
    ? "id, branch_id, version_number, merge_sequence, version_kind, submission_projection, geometry_digest, display_geometry, result_geometry, branch_vertex_snapshot, validation_report, closing_comment, merged_by, merged_at"
    : "id, branch_id, version_number, merge_sequence, version_kind, submission_projection, geometry_digest, validation_report, closing_comment, merged_by, merged_at";
  const { data: version, error } = await supabase
    .from("archive_versions")
    .select(columns)
    .eq("id", versionId)
    .maybeSingle();
  if (error) {
    throw archiveError(error.message || "Unable to load archive version.", {
      code: "ARCHIVE_VERSION_READ_FAILED",
    });
  }
  if (!version) {
    throw archiveError("Archive version was not found.", {
      statusCode: 404,
      code: "ARCHIVE_VERSION_NOT_FOUND",
    });
  }

  const { data: branch, error: branchError } = await supabase
    .from("archive_branches")
    .select("id, branch_key, submission_type, release_id, primary_dguid, secondary_dguid, head_version_id, head_version_number, resource_version")
    .eq("id", version.branch_id)
    .maybeSingle();
  if (branchError || !branch) {
    throw archiveError("Archive branch was not found.", {
      statusCode: 404,
      code: "ARCHIVE_BRANCH_NOT_FOUND",
    });
  }

  const emailsById = await loadProfileEmails(supabase, [
    version.merged_by,
    version.submission_projection?.user_id,
  ]);
  return {
    ...mapVersionRecord(branch, version, emailsById),
    displayGeometry: includeGeometry ? version.display_geometry ?? null : undefined,
    resultGeometry: includeGeometry ? version.result_geometry ?? null : undefined,
    branchVertexSnapshot: includeGeometry ? version.branch_vertex_snapshot ?? null : undefined,
    validationReport: version.validation_report ?? null,
  };
}

function neighborKey(primary, secondary) {
  return [String(primary), String(secondary)].sort().join("|");
}

export async function listArchiveProjectionsForDguid(supabase, dguid) {
  const normalized = String(dguid ?? "").trim();
  if (!normalized) {
    return { dguid: normalized, comments: [], objections: [], counterProposals: [] };
  }

  const { data: branches, error: branchError } = await supabase
    .from("archive_branches")
    .select("id, branch_key, submission_type, release_id, primary_dguid, secondary_dguid, head_version_id, head_version_number, resource_version, created_at, updated_at")
    .or(`primary_dguid.eq.${normalized},secondary_dguid.eq.${normalized}`);
  if (branchError) {
    throw archiveError(branchError.message || "Unable to load archive branches.", {
      code: "ARCHIVE_BRANCH_READ_FAILED",
    });
  }
  if (!branches?.length) {
    return {
      dguid: normalized,
      source: "v2",
      comments: [],
      objections: [],
      counterProposals: [],
    };
  }

  const branchIds = branches.map((branch) => branch.id);
  const { data: versions, error: versionError } = await supabase
    .from("archive_versions")
    .select(ARCHIVE_VERSION_SUMMARY_COLUMNS)
    .in("branch_id", branchIds)
    .order("version_number", { ascending: false });
  if (versionError) {
    throw archiveError(versionError.message || "Unable to load archive versions.", {
      code: "ARCHIVE_VERSION_READ_FAILED",
    });
  }

  const emailsById = await loadProfileEmails(
    supabase,
    (versions ?? []).flatMap((version) => [
      version.merged_by,
      version.submission_projection?.user_id,
    ]),
  );
  const branchesById = new Map(branches.map((branch) => [branch.id, branch]));
  const records = (versions ?? []).map((version) => mapVersionRecord(
    branchesById.get(version.branch_id),
    version,
    emailsById,
  ));
  const counterProposalImpactReports = await loadCounterProposalValidationReports(
    supabase,
    records
      .filter((record) => record.submissionType === "counter_proposal")
      .map((record) => record.submission?.id),
  );

  const comments = records
    .filter((record) => record.submissionType === "comment")
    .map((record) => ({
      versionId: record.versionId,
      branchId: record.branchId,
      branchKey: record.branchKey,
      versionNumber: record.versionNumber,
      isLatest: record.isLatest,
      mergedAt: record.mergedAt,
      mergedBy: record.mergedBy,
      closingComment: record.closingComment,
      submission: record.submission,
    }))
    .sort((left, right) => new Date(right.mergedAt) - new Date(left.mergedAt));

  const objectionsByNeighbor = new Map();
  const counterProposalsByNeighbor = new Map();

  records
    .filter((record) => record.submissionType === "objection")
    .forEach((record) => {
      const primary = String(record.primaryDguid ?? "");
      const secondary = String(record.secondaryDguid ?? "");
      const key = neighborKey(primary, secondary);
      const bucket = objectionsByNeighbor.get(key) ?? {
        neighborKey: key,
        primaryDguid: primary,
        secondaryDguid: secondary,
        versions: [],
      };
      bucket.versions.push({
        versionId: record.versionId,
        branchId: record.branchId,
        branchKey: record.branchKey,
        versionNumber: record.versionNumber,
        isLatest: record.isLatest,
        mergedAt: record.mergedAt,
        mergedBy: record.mergedBy,
        closingComment: record.closingComment,
        submission: record.submission,
      });
      objectionsByNeighbor.set(key, bucket);
    });

  records
    .filter((record) => record.submissionType === "counter_proposal")
    .forEach((record) => {
      const primary = String(record.primaryDguid ?? "");
      const secondary = String(record.secondaryDguid ?? "");
      const key = neighborKey(primary, secondary);
      const bucket = counterProposalsByNeighbor.get(key) ?? {
        neighborKey: key,
        primaryDguid: primary,
        secondaryDguid: secondary,
        versions: [],
      };
      bucket.versions.push({
        versionId: record.versionId,
        branchId: record.branchId,
        branchKey: record.branchKey,
        versionNumber: record.versionNumber,
        isLatest: record.isLatest,
        mergedAt: record.mergedAt,
        mergedBy: record.mergedBy,
        closingComment: record.closingComment,
        geometryDigest: record.geometryDigest,
        hasGeometry: record.hasGeometry,
        submission: record.submission,
        validationReport: counterProposalImpactReports.get(String(record.submission?.id))
          ?? record.validationReport
          ?? record.submission?.validation_report
          ?? null,
      });
      counterProposalsByNeighbor.set(key, bucket);
    });

  const sortVersions = (bucket) => ({
    ...bucket,
    versions: bucket.versions.sort((left, right) => {
      const versionDelta = Number(left.versionNumber) - Number(right.versionNumber);
      return versionDelta || new Date(left.mergedAt) - new Date(right.mergedAt);
    }),
  });

  return {
    dguid: normalized,
    source: "v2",
    comments,
    objections: [...objectionsByNeighbor.values()].map(sortVersions),
    counterProposals: [...counterProposalsByNeighbor.values()].map(sortVersions),
  };
}

async function resolveBranchCommunityName(primaryDguid, secondaryDguid = null) {
  const primaryProfile = await getProfileForDguid(primaryDguid);
  const primaryName = primaryProfile?.community_name ?? primaryProfile?.community ?? null;
  if (!secondaryDguid) return primaryName ?? "Unknown community";
  const secondaryProfile = await getProfileForDguid(secondaryDguid);
  const secondaryName = secondaryProfile?.community_name ?? secondaryProfile?.community ?? null;
  if (primaryName && secondaryName && primaryName !== secondaryName) {
    return `${primaryName} / ${secondaryName}`;
  }
  return primaryName ?? secondaryName ?? "Unknown community";
}

async function loadArchiveVersionViewGeometries(supabase, versionIds) {
  const uniqueIds = [...new Set((versionIds ?? []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("archive_versions")
    .select("id, display_geometry, geometry_digest")
    .in("id", uniqueIds);
  if (error) {
    throw archiveError(error.message || "Unable to load archive version geometry.", {
      code: "ARCHIVE_VERSION_READ_FAILED",
    });
  }
  return new Map((data ?? []).map((row) => [
    String(row.id),
    {
      displayGeometry: row.display_geometry ?? null,
      geometryDigest: row.geometry_digest ?? null,
    },
  ]));
}

function geometryPayloadFromRow(row) {
  if (!row) {
    return { displayGeometry: null, originalGeometry: null };
  }
  return {
    displayGeometry: row.displayGeometry ?? null,
    // Original CP boundaries live in canonical release assets, not in
    // submission_geometry_revisions or archive_versions columns.
    originalGeometry: null,
  };
}

export async function getArchiveBranchView(supabase, {
  selectedVersionId,
  branchKey = null,
  includeLatestGeometry = true,
} = {}) {
  const normalizedVersionId = String(selectedVersionId ?? "").trim();
  if (!normalizedVersionId) {
    throw archiveError("selectedVersionId is required.", {
      statusCode: 400,
      code: "ARCHIVE_VERSION_NOT_FOUND",
    });
  }

  const { data: anchorVersion, error: anchorError } = await supabase
    .from("archive_versions")
    .select(`
      id,
      branch_id,
      version_number,
      merge_sequence,
      version_kind,
      submission_projection,
      geometry_digest,
      validation_report,
      closing_comment,
      merged_by,
      merged_at,
      archive_branches!branch_id!inner (
        id,
        branch_key,
        submission_type,
        release_id,
        primary_dguid,
        secondary_dguid,
        head_version_id,
        head_version_number,
        resource_version,
        scope_pruids,
        created_at,
        updated_at
      )
    `)
    .eq("id", normalizedVersionId)
    .maybeSingle();
  if (anchorError) {
    throw archiveError(anchorError.message || "Unable to load archive version.", {
      code: "ARCHIVE_VERSION_READ_FAILED",
    });
  }
  if (!anchorVersion) {
    throw archiveError("Archive version was not found.", {
      statusCode: 404,
      code: "ARCHIVE_VERSION_NOT_FOUND",
    });
  }

  const branch = anchorVersion.archive_branches;
  const { data: versions, error: versionError } = await supabase
    .from("archive_versions")
    .select(ARCHIVE_VERSION_SUMMARY_COLUMNS)
    .eq("branch_id", branch.id)
    .order("version_number", { ascending: false });
  if (versionError) {
    throw archiveError(versionError.message || "Unable to load archive branch versions.", {
      code: "ARCHIVE_VERSION_READ_FAILED",
    });
  }

  const emailsById = await loadProfileEmails(
    supabase,
    (versions ?? []).flatMap((version) => [
      version.merged_by,
      version.submission_projection?.user_id,
    ]),
  );
  const mappedVersions = (versions ?? []).map((version) => mapVersionRecord(branch, version, emailsById));
  const latestVersion = mappedVersions.find((version) => version.isLatest) ?? mappedVersions[0] ?? null;
  const selectedVersion = mappedVersions.find((version) => (
    String(version.versionId) === normalizedVersionId
    || String(version.submission?.id) === normalizedVersionId
  )) ?? mapVersionRecord(branch, anchorVersion, emailsById);

  const resolvedSelectedVersionId = String(selectedVersion?.versionId ?? "");
  const resolvedLatestVersionId = String(latestVersion?.versionId ?? "");
  const selectedSameAsLatest = resolvedSelectedVersionId && resolvedSelectedVersionId === resolvedLatestVersionId;

  const geometryIds = [];
  if (resolvedSelectedVersionId) {
    geometryIds.push(resolvedSelectedVersionId);
  }
  if (includeLatestGeometry && resolvedLatestVersionId && !selectedSameAsLatest) {
    geometryIds.push(resolvedLatestVersionId);
  }

  const revisionPromise = getArchiveMapRevisionSequence(supabase);
  const communityPromise = resolveBranchCommunityName(
    branch.primary_dguid,
    branch.secondary_dguid,
  );
  const geometriesPromise = geometryIds.length
    ? loadArchiveVersionViewGeometries(supabase, geometryIds)
    : Promise.resolve(new Map());

  const [geometriesById, communityName, archiveMapRevision] = await Promise.all([
    geometriesPromise,
    communityPromise,
    revisionPromise,
  ]);

  const geometryByVersionId = {};
  for (const versionId of geometryIds) {
    const row = geometriesById.get(String(versionId));
    const payload = geometryPayloadFromRow(row);
    geometryByVersionId[String(versionId)] = {
      displayGeometry: payload.displayGeometry,
      geometryDigest: row?.geometryDigest ?? null,
    };
  }

  if (selectedSameAsLatest && geometryByVersionId[resolvedSelectedVersionId]) {
    geometryByVersionId[resolvedLatestVersionId] = geometryByVersionId[resolvedSelectedVersionId];
  }

  const selectedGeometryEntry = geometryByVersionId[resolvedSelectedVersionId] ?? null;
  const latestGeometryEntry = selectedSameAsLatest
    ? selectedGeometryEntry
    : (geometryByVersionId[resolvedLatestVersionId] ?? null);

  const selectedDisplayGeometry = selectedGeometryEntry?.displayGeometry ?? null;
  const latestDisplayGeometry = latestGeometryEntry?.displayGeometry ?? null;
  const selectedOriginalGeometry = null;
  const latestOriginalGeometry = null;

  return {
    source: "v2",
    branch: {
      id: branch.id,
      key: branch.branch_key,
      branchKey: branch.branch_key,
      submissionType: branch.submission_type,
      primaryDguid: branch.primary_dguid,
      secondaryDguid: branch.secondary_dguid ?? null,
      dguids: [branch.primary_dguid, branch.secondary_dguid].filter(Boolean),
      communityName,
      resourceVersion: Number(branch.resource_version) || 1,
      headVersionId: branch.head_version_id,
      headVersionNumber: Number(branch.head_version_number) || null,
      releaseId: branch.release_id ?? null,
    },
    versions: mappedVersions,
    selectedVersion,
    latestVersion,
    selectedVersionId: resolvedSelectedVersionId,
    latestVersionId: resolvedLatestVersionId,
    geometryByVersionId,
    selectedDisplayGeometry,
    latestDisplayGeometry,
    selectedOriginalGeometry,
    latestOriginalGeometry,
    archiveMapRevision,
  };
}
