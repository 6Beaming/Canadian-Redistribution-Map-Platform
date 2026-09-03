import { formatCsvHeader, formatCsvRow } from "./csvWriter.js";
import { filterSubmissionsForCommissionerScope } from "../authorization/resourceScopeGuard.js";
import { projectArchiveRequestVisibility } from "../archiveRequests/visibilityProjection.js";
import { enrichSubmissionsWithDaMetadata } from "../map/submissionPresentation.js";
import {
  LIGHTWEIGHT_SUBMISSION_COLUMNS,
  serializeLightweightSubmission,
} from "../submissions/submissionListQuery.js";
import {
  iterateCommissionerExportRows,
  normalizeSubmissionExportRequest,
} from "../submissions/submissionExportRepository.js";

export const CSV_COLUMNS = [
  { label: "Reference ID", value: (row) => row.id },
  { label: "Submitted At", value: (row) => row.created_at },
  { label: "Submitted By", value: (row) => row.authorEmail ?? "Unknown" },
  { label: "Type", value: (row) => row.type },
  { label: "Title", value: (row) => row.title },
  { label: "Community Name", value: (row) => row.dissemination_areas?.community_name ?? "Unknown" },
  { label: "Status", value: (row) => row.status },
  { label: "Tags", value: (row) => row.tags.join("; ") },
  { label: "Primary DGUID", value: (row) => row.dguid ?? "" },
  { label: "Secondary DGUID", value: (row) => row.neighboring_dguid ?? "" },
  { label: "FED", value: (row) => row.fed_num ?? "" },
];

export { formatCsvHeader, formatCsvRow };

export async function loadSubmissionTags(supabase, submissionIds) {
  if (!submissionIds.length) return new Map();
  const { data, error } = await supabase.from("workspace_labels")
    .select("submission_id,name,is_selected,updated_at")
    .in("submission_id", submissionIds)
    .order("updated_at", { ascending: true });
  if (error) throw error;
  const tagsBySubmissionId = new Map();
  (data ?? []).filter((row) => row.is_selected !== false).forEach((row) => {
    const submissionId = String(row.submission_id);
    if (!tagsBySubmissionId.has(submissionId)) tagsBySubmissionId.set(submissionId, []);
    tagsBySubmissionId.get(submissionId).push(row.name);
  });
  return tagsBySubmissionId;
}

const STREAM_BATCH_SIZE = 100;
const ID_CHUNK_SIZE = 100;

async function loadSubmissionExportRowsById(supabase, submissionIds, actorProfile) {
  const scopedRows = [];
  for (let index = 0; index < submissionIds.length; index += ID_CHUNK_SIZE) {
    const chunk = submissionIds.slice(index, index + ID_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("submissions")
      .select(LIGHTWEIGHT_SUBMISSION_COLUMNS)
      .in("id", chunk);
    if (error) throw error;
    scopedRows.push(...await filterSubmissionsForCommissionerScope(data ?? [], actorProfile));
  }

  const enriched = await enrichSubmissionsWithDaMetadata(scopedRows);
  const projected = await projectArchiveRequestVisibility(
    supabase,
    enriched,
    actorProfile.id,
  );
  const userIds = [...new Set(projected.map((row) => row.user_id).filter(Boolean))];
  let profileById = new Map();
  if (userIds.length) {
    const { data: profiles, error: profileError } = await supabase.from("profiles")
      .select("id,email")
      .in("id", userIds);
    if (profileError) throw profileError;
    profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  }

  const rowsById = new Map(projected.map((row) => [
    String(row.id),
    serializeLightweightSubmission(row, profileById.get(row.user_id)),
  ]));
  return submissionIds.flatMap((submissionId) => rowsById.get(submissionId) ?? []);
}

async function* iterateExportRows(supabase, actorProfile, exportRequest, body) {
  const usesFilteredExport = Boolean(
    body.filters
    || body.types
    || exportRequest.filters.createdFrom
    || exportRequest.filters.createdTo
    || exportRequest.filters.type
    || exportRequest.filters.status,
  );

  if (!usesFilteredExport && exportRequest.submissionIdSet?.size) {
    const rows = await loadSubmissionExportRowsById(
      supabase,
      [...exportRequest.submissionIdSet],
      actorProfile,
    );
    for (const row of rows) {
      yield row;
    }
    return;
  }

  yield* iterateCommissionerExportRows(supabase, {
    actorProfile,
    ...exportRequest,
  });
}

async function flushExportBatch(res, supabase, rows) {
  if (!rows.length) return;
  const tagsBySubmissionId = await loadSubmissionTags(
    supabase,
    rows.map((row) => String(row.id)),
  );
  for (const row of rows) {
    const payload = {
      ...row,
      tags: tagsBySubmissionId.get(String(row.id)) ?? [],
    };
    res.write(formatCsvRow(CSV_COLUMNS, payload));
  }
}

export async function streamCommissionerSubmissionCsv(res, supabase, {
  actorProfile,
  body,
  serverTiming,
}) {
  const exportRequest = normalizeSubmissionExportRequest(body);
  const dbSpan = serverTiming?.start("db");
  const buffer = [];
  let rowCount = 0;

  for await (const row of iterateExportRows(supabase, actorProfile, exportRequest, body)) {
    buffer.push(row);
    rowCount += 1;
    if (buffer.length >= STREAM_BATCH_SIZE) {
      await flushExportBatch(res, supabase, buffer);
      buffer.length = 0;
    }
  }

  if (buffer.length) {
    await flushExportBatch(res, supabase, buffer);
  }

  dbSpan?.end({ rows: rowCount });
  serverTiming?.measure("serialize", 0);
}
