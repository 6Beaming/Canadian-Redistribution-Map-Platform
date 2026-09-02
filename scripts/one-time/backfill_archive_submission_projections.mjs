#!/usr/bin/env node
import "dotenv/config";
import { loadLocalRelease, redactError, requireAdminClient } from "../reusable/map_release_db.mjs";
import { normalizeArchiveSubmissionProjection } from "../../server/lib/archive/archiveRepository.js";
import { calculateCounterProposalImpact } from "../../src/lib/map/counterProposalImpact.js";

const apply = process.argv.includes("--apply");
const supabase = requireAdminClient();
const release = loadLocalRelease();

function needsProjectionBackfill(projection) {
  if (!projection || typeof projection !== "object") return true;
  const author = projection.author && typeof projection.author === "object" ? projection.author : null;
  const missingUser = !projection.user_id && author?.id;
  const missingCreatedAt = !projection.created_at && projection.submitted_at;
  const missingAuthorEmail = !projection.authorEmail
    && !projection.profile?.email
    && Boolean(author?.email || projection.user_id || author?.id);
  return missingUser || missingCreatedAt || missingAuthorEmail;
}

function needsImpactBackfill(branchType, validationReport) {
  if (branchType !== "counter_proposal") return false;
  return !validationReport?.impact_summary;
}

function populationForDguid(dguid) {
  const entry = release.dguids[String(dguid ?? "").trim()];
  return entry?.population ?? null;
}

async function loadBranchesById() {
  const { data, error } = await supabase
    .from("archive_branches")
    .select("id,submission_type,primary_dguid,secondary_dguid");
  if (error) throw error;
  return new Map((data ?? []).map((branch) => [branch.id, branch]));
}

async function loadProfileEmails(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase.from("profiles").select("id,email").in("id", uniqueIds);
  if (error) throw error;
  return new Map((data ?? []).map((profile) => [profile.id, profile.email]));
}

async function loadSubmissionSnapshots(submissionIds) {
  const uniqueIds = [...new Set(submissionIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("submissions")
    .select("id,user_id,created_at,title,comment,type,dguid,neighboring_dguid")
    .in("id", uniqueIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row]));
}

async function loadGeometryRevisions(submissionIds) {
  const uniqueIds = [...new Set(submissionIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("submission_geometry_revisions")
    .select("id,submission_id,revision_number,primary_dguid,secondary_dguid,validation_report,legacy_revision_id,migration_state")
    .in("submission_id", uniqueIds)
    .order("revision_number", { ascending: false });
  if (error) throw error;
  const latest = new Map();
  for (const row of data ?? []) {
    if (!latest.has(row.submission_id)) latest.set(row.submission_id, row);
  }
  return latest;
}

async function loadLegacyRevisions(submissionIds) {
  const uniqueIds = [...new Set(submissionIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("counter_proposal_revisions")
    .select("id,submission_id,revision_number,primary_dguid,secondary_dguid,original_geometry,proposed_geometry,validation_report")
    .in("submission_id", uniqueIds)
    .order("revision_number", { ascending: false });
  if (error) throw error;
  const latest = new Map();
  for (const row of data ?? []) {
    if (!latest.has(row.submission_id)) latest.set(row.submission_id, row);
  }
  return latest;
}

async function loadLegacyRevisionsById(revisionIds) {
  const uniqueIds = [...new Set(revisionIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("counter_proposal_revisions")
    .select("id,submission_id,revision_number,primary_dguid,secondary_dguid,original_geometry,proposed_geometry,validation_report")
    .in("id", uniqueIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row]));
}

function buildImpactSummary(branch, geometryRevision, legacyRevision, version) {
  const existingImpact = geometryRevision?.validation_report?.impact_summary
    ?? legacyRevision?.validation_report?.impact_summary;
  if (existingImpact) {
    return existingImpact;
  }

  const original = legacyRevision?.original_geometry ?? null;
  const proposed = legacyRevision?.proposed_geometry
    ?? version.result_geometry
    ?? version.display_geometry
    ?? null;
  if (!original || !proposed) {
    return {
      version: 1,
      availability: "unavailable",
      reason: geometryRevision?.migration_state === "manual_review"
        ? "migration_backfill_geometry_manual_review"
        : "migration_backfill_missing_geometry",
    };
  }
  const firstDguid = String(branch.primary_dguid ?? legacyRevision?.primary_dguid ?? geometryRevision?.primary_dguid ?? "");
  const secondDguid = String(branch.secondary_dguid ?? legacyRevision?.secondary_dguid ?? geometryRevision?.secondary_dguid ?? "");
  return calculateCounterProposalImpact({
    originalFeatures: original,
    proposedFeatures: proposed,
    firstDguid,
    secondDguid,
    populationByDguid: new Map([
      [firstDguid, populationForDguid(firstDguid)],
      [secondDguid, populationForDguid(secondDguid)],
    ]),
  });
}

const report = {
  mode: apply ? "apply" : "dry-run",
  scanned: 0,
  projectionUpdates: 0,
  impactUpdates: 0,
  skipped: 0,
  failures: [],
};

const branchesById = await loadBranchesById();
const { data: versions, error: versionsError } = await supabase
  .from("archive_versions")
  .select("id,branch_id,source_submission_id,submission_projection,validation_report,result_geometry,display_geometry");
if (versionsError) throw versionsError;

const submissionIds = (versions ?? []).map((version) =>
  version.source_submission_id ?? version.submission_projection?.id ?? null,
);
const [
  submissionsById,
  geometryRevisionsBySubmission,
  legacyRevisionsBySubmission,
] = await Promise.all([
  loadSubmissionSnapshots(submissionIds),
  loadGeometryRevisions(submissionIds),
  loadLegacyRevisions(submissionIds),
]);
const legacyRevisionsById = await loadLegacyRevisionsById(
  [...geometryRevisionsBySubmission.values()].map((row) => row.legacy_revision_id).filter(Boolean),
);

const userIds = (versions ?? []).flatMap((version) => {
  const projection = version.submission_projection ?? {};
  const submission = submissionsById.get(version.source_submission_id);
  return [projection.user_id, projection.author?.id, submission?.user_id].filter(Boolean);
});
const resolvedEmails = await loadProfileEmails(userIds);

for (const version of versions ?? []) {
  report.scanned += 1;
  const branch = branchesById.get(version.branch_id);
  const submissionId = version.source_submission_id ?? version.submission_projection?.id ?? null;
  const submission = submissionId ? submissionsById.get(submissionId) : null;
  const projection = {
    ...(version.submission_projection ?? {}),
    id: version.submission_projection?.id ?? submissionId ?? submission?.id ?? null,
    user_id: version.submission_projection?.user_id
      ?? version.submission_projection?.author?.id
      ?? submission?.user_id
      ?? null,
    created_at: version.submission_projection?.created_at
      ?? version.submission_projection?.submitted_at
      ?? submission?.created_at
      ?? null,
    title: version.submission_projection?.title ?? submission?.title ?? "",
    comment: version.submission_projection?.comment ?? submission?.comment ?? "",
    dguid: version.submission_projection?.dguid ?? branch?.primary_dguid ?? submission?.dguid ?? null,
    neighboring_dguid: version.submission_projection?.neighboring_dguid
      ?? branch?.secondary_dguid
      ?? submission?.neighboring_dguid
      ?? null,
  };
  const authorEmail = resolvedEmails.get(projection.user_id) ?? projection.authorEmail ?? null;
  const normalizedProjection = normalizeArchiveSubmissionProjection(projection, { authorEmail });
  const projectionChanged = needsProjectionBackfill(version.submission_projection)
    || JSON.stringify(normalizedProjection) !== JSON.stringify(version.submission_projection ?? {});

  let validationReport = version.validation_report ?? {};
  let impactChanged = false;
  if (needsImpactBackfill(branch?.submission_type, validationReport)) {
    const geometryRevision = geometryRevisionsBySubmission.get(submissionId);
    const legacyRevision = legacyRevisionsBySubmission.get(submissionId)
      ?? (geometryRevision?.legacy_revision_id
        ? legacyRevisionsById.get(geometryRevision.legacy_revision_id)
        : null);
    const impactSummary = buildImpactSummary(branch, geometryRevision, legacyRevision, version);
    validationReport = {
      ...validationReport,
      impact_summary: impactSummary,
      migrationImpactBackfill: impactSummary.availability === "unavailable"
        ? impactSummary.reason
        : "geometry_revision_or_legacy_snapshot",
    };
    impactChanged = true;
  }

  if (!projectionChanged && !impactChanged) {
    report.skipped += 1;
    continue;
  }

  const payload = {};
  if (projectionChanged) {
    payload.submission_projection = normalizedProjection;
    report.projectionUpdates += 1;
  }
  if (impactChanged) {
    payload.validation_report = validationReport;
    report.impactUpdates += 1;
  }

  if (!apply) continue;

  try {
    const { error } = await supabase.from("archive_versions").update(payload).eq("id", version.id);
    if (error) throw error;
  } catch (error) {
    report.failures.push({ versionId: version.id, reason: redactError(error) });
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
