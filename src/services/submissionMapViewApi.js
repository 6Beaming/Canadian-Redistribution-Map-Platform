import { mapApi } from "@/services/mapApi.js";
import { getSubmissionMaterializedGeometry } from "@/services/submissionsApi.js";
import { loadSubmissionMapPresentation } from "@/services/submissionMapPresentation.js";
import {
  buildDaObjectionIndex,
  getPairOuterBoundaryFeatureCollection,
  getSharedBoundaryFeatureCollection,
} from "@/lib/map/objectionWorkflow.js";

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

function normalizedSubmission(payload) {
  return {
    ...payload.submission,
    created_at: payload.submission.createdAt,
    updated_at: payload.submission.updatedAt,
    dguid: payload.map.primaryDguid,
    neighboring_dguid: payload.map.secondaryDguid,
    authorEmail: payload.submission.author?.email ?? null,
    source: "supabase",
    mapDescriptor: payload.map,
    submissionProjection: payload.submission,
  };
}

export async function hydrateSubmissionMapView(payload) {
  const submission = normalizedSubmission(payload);
  const type = String(payload.submission.type ?? "feedback").replaceAll("_", "-");
  const { releaseId, primaryDguid, secondaryDguid } = payload.map;
  if (!releaseId || !primaryDguid) {
    return { ...submission, geometry: null, geometryError: "Submission release metadata is unavailable." };
  }

  if (type === "feedback" || type === "comment" || type === "objection") {
    const presentation = await loadSubmissionMapPresentation({
      submission: { ...submission, type },
      releaseId,
      primaryDguid,
      secondaryDguid,
    });
    if (!presentation?.objectionPreview) {
      return {
        ...submission,
        geometry: null,
        geometryError: "Submission map geometry could not be loaded from the release.",
      };
    }
    return {
      ...submission,
      geometry: presentation.objectionPreview,
    };
  }

  const basePair = await mapApi.getReleaseDaPair(releaseId, primaryDguid, secondaryDguid, {
    representation: "display",
  });
  const baseIndex = buildDaObjectionIndex(basePair.features);

  const detail = await getSubmissionMaterializedGeometry(payload.submission.id);
  const proposed = detail.geometry;
  const proposedIndex = buildDaObjectionIndex(proposed);

  return {
    ...submission,
    geometry: {
      originalFeatureCollection: basePair.features,
      proposedFeatureCollection: proposed,
      originalBoundaryGeoJson: getSharedBoundaryFeatureCollection(baseIndex, primaryDguid, secondaryDguid),
      originalOuterBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(baseIndex, [primaryDguid, secondaryDguid]),
      boundaryGeoJson: getSharedBoundaryFeatureCollection(proposedIndex, primaryDguid, secondaryDguid),
      outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(proposedIndex, [primaryDguid, secondaryDguid]),
      impacts: detail.impactSummary ?? payload.map.impactSummary ?? null,
      impactsSource: "compact-revision",
      baselineRevision: payload.map.baseRevision,
    },
  };
}
