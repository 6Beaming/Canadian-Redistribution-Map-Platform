import { archiveError } from "./archiveErrors.js";
import { calculateCounterProposalImpact } from "../../../src/lib/map/counterProposalImpact.js";
import { loadProfileIndex } from "../map/mapAssetAuthority.js";

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

function projectionToSubmission(projection, branch, emailsById = new Map()) {
  const submission = {
    ...(projection ?? {}),
    id: projection?.id ?? projection?.source_submission_id ?? null,
    type: mapLegacyTypeToSubmission(branch?.submission_type ?? projection?.type),
    dguid: branch?.primary_dguid ?? projection?.dguid ?? projection?.primaryDguid ?? null,
    neighboring_dguid: branch?.secondary_dguid ?? projection?.neighboring_dguid ?? projection?.secondaryDguid ?? null,
    status: "archived",
  };
  const authorEmail = emailsById.get(submission.user_id)
    ?? submission.authorEmail
    ?? submission.profile?.email
    ?? null;
  if (authorEmail) {
    submission.authorEmail = authorEmail;
    submission.profile = { ...(submission.profile ?? {}), email: authorEmail };
  }
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
    hasGeometry: Boolean(version.display_geometry || version.result_geometry),
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
    .from("counter_proposal_revisions")
    .select("submission_id,revision_number,validation_report")
    .in("submission_id", uniqueIds)
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

async function loadCounterProposalImpactReports(supabase, submissionIds) {
  const uniqueIds = [...new Set((submissionIds ?? []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("counter_proposal_revisions")
    .select("submission_id,revision_number,primary_dguid,secondary_dguid,original_geometry,proposed_geometry,validation_report")
    .in("submission_id", uniqueIds)
    .order("revision_number", { ascending: false });
  if (error) {
    throw archiveError(error.message || "Unable to load archived Counter-Proposal impact.", {
      code: "ARCHIVE_IMPACT_READ_FAILED",
    });
  }

  const latestBySubmission = new Map();
  for (const revision of data ?? []) {
    const submissionId = String(revision.submission_id ?? "");
    if (submissionId && !latestBySubmission.has(submissionId)) {
      latestBySubmission.set(submissionId, revision);
    }
  }

  const requiresCalculation = [...latestBySubmission.values()].some(
    (revision) => !revision.validation_report?.impact_summary
      && revision.original_geometry
      && revision.proposed_geometry,
  );
  const profilesByDguid = requiresCalculation ? (await loadProfileIndex()).index : new Map();
  return new Map([...latestBySubmission].map(([submissionId, revision]) => {
    const existingReport = revision.validation_report ?? {};
    if (existingReport.impact_summary || !revision.original_geometry || !revision.proposed_geometry) {
      return [submissionId, existingReport];
    }
    const firstDguid = String(revision.primary_dguid ?? "");
    const secondDguid = String(revision.secondary_dguid ?? "");
    const impactSummary = calculateCounterProposalImpact({
      originalFeatures: revision.original_geometry,
      proposedFeatures: revision.proposed_geometry,
      firstDguid,
      secondDguid,
      populationByDguid: new Map([
        [firstDguid, profilesByDguid.get(firstDguid)?.population ?? null],
        [secondDguid, profilesByDguid.get(secondDguid)?.population ?? null],
      ]),
    });
    return [submissionId, { ...existingReport, impact_summary: impactSummary }];
  }));
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

async function listLegacyArchiveRecords(supabase) {
  const { data, error } = await supabase
    .from("archive_tree")
    .select("*")
    .order("merged_at", { ascending: false });
  if (error) {
    if (error.code === "PGRST205") return [];
    throw archiveError(error.message || "Unable to load legacy archive records.", {
      code: "ARCHIVE_TREE_READ_FAILED",
    });
  }
  const emailsById = await loadProfileEmails(
    supabase,
    (data ?? []).flatMap((record) => [
      record.merged_by,
      record.reverted_by,
      record.submission_snapshot?.user_id,
    ]),
  );
  const validationReports = await loadCounterProposalValidationReports(
    supabase,
    (data ?? [])
      .filter((record) => normalizeSubmissionType(record.submission_snapshot?.type) === "counter_proposal")
      .map((record) => record.submission_snapshot?.id),
  );
  return (data ?? []).map((record) => mapLegacyArchiveRecord(
    record,
    emailsById,
    validationReports,
  ));
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
    .select("id, branch_id, version_number, merge_sequence, version_kind, submission_projection, geometry_digest, display_geometry, result_geometry, validation_report, closing_comment, merged_by, merged_at")
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
  if (v2Records.length) {
    return { source: "v2", records: v2Records };
  }
  const legacyRecords = await listLegacyArchiveRecords(supabase);
  return { source: "legacy", records: legacyRecords };
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
    .select("id, branch_id, version_number, merge_sequence, version_kind, submission_projection, geometry_digest, display_geometry, result_geometry, validation_report, closing_comment, merged_by, merged_at")
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
    const { data: legacyVersion, error: legacyError } = await supabase
      .from("archive_tree")
      .select("*")
      .eq("id", versionId)
      .maybeSingle();
    if (legacyError) {
      throw archiveError(legacyError.message || "Unable to load the legacy archive version.", {
        code: "ARCHIVE_VERSION_READ_FAILED",
      });
    }
    if (!legacyVersion) {
      throw archiveError("Archive version was not found.", {
        statusCode: 404,
        code: "ARCHIVE_VERSION_NOT_FOUND",
      });
    }
    const submissionId = legacyVersion.submission_snapshot?.id;
    const [emailsById, validationReports] = await Promise.all([
      loadProfileEmails(supabase, [
        legacyVersion.merged_by,
        legacyVersion.reverted_by,
        legacyVersion.submission_snapshot?.user_id,
      ].filter(Boolean)),
      loadCounterProposalValidationReports(
        supabase,
        normalizeSubmissionType(legacyVersion.submission_snapshot?.type) === "counter_proposal"
          ? [submissionId]
          : [],
      ),
    ]);
    const mapped = mapLegacyArchiveRecord(legacyVersion, emailsById, validationReports);
    return {
      ...mapped,
      displayGeometry: includeGeometry ? legacyVersion.submission_snapshot?.geometry ?? null : undefined,
      resultGeometry: includeGeometry ? legacyVersion.submission_snapshot?.geometry ?? null : undefined,
      branchVertexSnapshot: includeGeometry ? null : undefined,
      validationReport: mapped.validationReport,
    };
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

  const { source, records } = await listArchiveTreeRecords(supabase);
  const relevant = records.filter((record) => {
    const primary = String(record.primaryDguid ?? record.submission?.dguid ?? "");
    const secondary = String(record.secondaryDguid ?? record.submission?.neighboring_dguid ?? "");
    return primary === normalized || secondary === normalized;
  });
  const counterProposalImpactReports = await loadCounterProposalImpactReports(
    supabase,
    relevant
      .filter((record) => record.submissionType === "counter_proposal")
      .map((record) => record.submission?.id),
  );

  const comments = relevant
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

  relevant
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

  relevant
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
    source,
    comments,
    objections: [...objectionsByNeighbor.values()].map(sortVersions),
    counterProposals: [...counterProposalsByNeighbor.values()].map(sortVersions),
  };
}
