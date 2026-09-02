import { getSupabaseAdminDataClient } from "../supabase.js";

export function getArchiveRequestAdmin() {
  return getSupabaseAdminDataClient();
}

export async function loadSubmissionForArchive(supabase, submissionId) {
  const { data, error } = await supabase
    .from("submissions")
    .select("id,type,status,dguid,neighboring_dguid,resource_version,active_claim_pruid,active_claim_kind,user_id,updated_at")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadLatestSubmissionGeometryRevision(supabase, submissionId) {
  const { data, error } = await supabase
    .from("submission_geometry_revisions")
    .select("*")
    .eq("submission_id", submissionId)
    .order("revision_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function insertArchiveSourceRevision(supabase, row) {
  const { data, error } = await supabase
    .from("archive_source_revisions")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function insertArchiveRequest(supabase, row) {
  const { data, error } = await supabase
    .from("workspace_archive_requests")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function loadArchiveRequestBySubmissionId(supabase, submissionId) {
  const { data, error } = await supabase
    .from("workspace_archive_requests")
    .select("*")
    .eq("submission_id", submissionId)
    .in("state", ["open", "approved"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function loadArchiveRequestById(supabase, requestId) {
  const { data, error } = await supabase
    .from("workspace_archive_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateArchiveRequest(supabase, requestId, expectedVersion, values) {
  const { data, error } = await supabase
    .from("workspace_archive_requests")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("resource_version", expectedVersion)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listVotes(supabase, requestId) {
  const { data, error } = await supabase
    .from("workspace_archive_request_votes")
    .select("*")
    .eq("request_id", requestId);
  if (error) throw error;
  return data ?? [];
}

export async function upsertVote(supabase, { requestId, voterId, vote }) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("workspace_archive_request_votes")
    .upsert({
      request_id: requestId,
      voter_id: voterId,
      vote,
      updated_at: now,
      created_at: now,
    }, { onConflict: "request_id,voter_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteVotesNotIn(supabase, requestId, voterIds) {
  const { data: existing, error } = await supabase
    .from("workspace_archive_request_votes")
    .select("voter_id")
    .eq("request_id", requestId);
  if (error) throw error;

  const keep = new Set((voterIds ?? []).map(String));
  const removable = (existing ?? [])
    .map((row) => row.voter_id)
    .filter((id) => !keep.has(String(id)));

  if (!removable.length) return;
  const { error: deleteError } = await supabase
    .from("workspace_archive_request_votes")
    .delete()
    .eq("request_id", requestId)
    .in("voter_id", removable);
  if (deleteError) throw deleteError;
}

export async function loadProfilesByIds(supabase, ids) {
  const unique = [...new Set((ids ?? []).filter(Boolean).map(String))];
  if (!unique.length) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,role,province")
    .in("id", unique);
  if (error) throw error;
  return data ?? [];
}

export async function loadCommissionerProfilesByEmails(supabase, emails) {
  const uniqueOriginal = [...new Set((emails ?? [])
    .map((email) => String(email ?? "").trim())
    .filter(Boolean))];
  if (!uniqueOriginal.length) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,role,province")
    .eq("role", "commissioner")
    .in("email", uniqueOriginal);
  if (error) throw error;

  const wanted = new Set(uniqueOriginal.map((email) => email.toLowerCase()));
  const matched = (data ?? []).filter((profile) =>
    wanted.has(String(profile.email ?? "").trim().toLowerCase()));

  if (matched.length !== wanted.size) {
    // Retry with exact set size check using lower-case compare only.
    return matched;
  }
  return matched;
}

export async function updateSubmissionArchiveFields(supabase, {
  submissionId,
  expectedVersion,
  operatingPruid,
  values,
}) {
  let query = supabase
    .from("submissions")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (expectedVersion !== null && expectedVersion !== undefined) {
    query = query.eq("resource_version", expectedVersion);
  }

  if (operatingPruid) {
    query = query.or(
      `active_claim_pruid.is.null,active_claim_pruid.eq.${operatingPruid}`,
    );
  }

  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function insertOutboxEvent(supabase, event) {
  const { data, error } = await supabase
    .from("realtime_outbox")
    .insert(event)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function insertScopeDelivery(supabase, { outboxId, pruid }) {
  const { data: latestRows, error: latestError } = await supabase
    .from("realtime_scope_deliveries")
    .select("scope_sequence")
    .eq("pruid", pruid)
    .order("scope_sequence", { ascending: false })
    .limit(1);
  if (latestError) throw latestError;

  const scopeSequence = Number(latestRows?.[0]?.scope_sequence ?? 0) + 1;
  const { data, error } = await supabase
    .from("realtime_scope_deliveries")
    .insert({
      outbox_id: outboxId,
      pruid,
      scope_sequence: scopeSequence,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
