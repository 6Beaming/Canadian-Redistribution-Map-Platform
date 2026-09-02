export async function loadLatestCounterProposalGeometryRevision(supabase, submissionId) {
  const { data, error } = await supabase
    .from("submission_geometry_revisions")
    .select("id,submission_id,submission_type,revision_number,release_id,base_revision,primary_dguid,secondary_dguid,geometry_digest,validation_report,migration_state,created_at")
    .eq("submission_id", submissionId)
    .eq("submission_type", "counter_proposal")
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadLatestCounterProposalGeometryRevisions(supabase, submissionIds) {
  const uniqueIds = [...new Set((submissionIds ?? []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("submission_geometry_revisions")
    .select("id,submission_id,submission_type,revision_number,release_id,base_revision,primary_dguid,secondary_dguid,geometry_digest,validation_report,migration_state,created_at")
    .in("submission_id", uniqueIds)
    .eq("submission_type", "counter_proposal")
    .order("revision_number", { ascending: false });
  if (error) throw error;
  const latest = new Map();
  for (const row of data ?? []) {
    if (!latest.has(row.submission_id)) latest.set(row.submission_id, row);
  }
  return latest;
}

export function geometryRevisionToApiRevision(geometryRevision) {
  if (!geometryRevision) return null;
  return {
    id: geometryRevision.id,
    submission_id: geometryRevision.submission_id,
    revision_number: geometryRevision.revision_number,
    primary_dguid: geometryRevision.primary_dguid,
    secondary_dguid: geometryRevision.secondary_dguid,
    baseline_revision: geometryRevision.base_revision,
    validation_report: geometryRevision.validation_report ?? {},
    geometry_digest: geometryRevision.geometry_digest,
    migration_state: geometryRevision.migration_state,
    release_id: geometryRevision.release_id,
    created_at: geometryRevision.created_at,
  };
}
