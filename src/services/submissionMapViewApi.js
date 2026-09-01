import { hydrateWorkspaceSubmission } from "@/services/tempCounterProposal.js";

async function requestJson(url) {
  const response = await fetch(url, { credentials: "include" });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = payload.code ?? null;
    throw error;
  }

  return payload;
}

export function getSubmissionMapView(submissionId) {
  return requestJson(
    `/api/submissions/${encodeURIComponent(submissionId)}/map-view`,
  );
}

function toLegacyHydrationInput(payload) {
  return {
    ...payload.submission,
    type: payload.submission.type,
    created_at: payload.submission.createdAt,
    updated_at: payload.submission.updatedAt,
    dguid: payload.map.primaryDguid,
    neighboring_dguid: payload.map.secondaryDguid,
    authorEmail: payload.submission.author?.email ?? null,
    source: "supabase",
  };
}

/**
 * Adapter seam for the immutable release API. The page consumes the normalized
 * result only; when the release routes are ready this function can replace its
 * legacy local-metadata hydration without changing routing or presentation.
 */
export async function hydrateSubmissionMapView(payload) {
  const hydrated = await hydrateWorkspaceSubmission(
    toLegacyHydrationInput(payload),
  );

  return {
    ...hydrated,
    mapDescriptor: payload.map,
    submissionProjection: payload.submission,
  };
}
