import {
  buildDaObjectionIndex,
  getPairOuterBoundaryFeatureCollection,
  getSharedBoundaryFeatureCollection,
} from "@/lib/map/objectionWorkflow.js";
import { buildArchivedDifferencePresentation } from "@/lib/archiveDifferencePresentation.js";
import { mapApi } from "@/services/mapApi.js";

function normalizeSubmissionType(type) {
  const normalized = String(type ?? "feedback").trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "comment") return "feedback";
  return normalized;
}

function asFeatureCollection(payload) {
  if (!payload) return null;
  if (payload.type === "FeatureCollection") return payload;
  if (payload.features?.type === "FeatureCollection") return payload.features;
  if (payload.featureCollection?.type === "FeatureCollection") return payload.featureCollection;
  if (payload.geometry?.type === "FeatureCollection") return payload.geometry;
  if (payload.feature?.type === "Feature") {
    return { type: "FeatureCollection", features: [payload.feature] };
  }
  if (payload.type === "Feature") {
    return { type: "FeatureCollection", features: [payload] };
  }
  return null;
}

function pairFromReleasePayload(payload, primaryDguid, secondaryDguid) {
  const featureCollection = asFeatureCollection(payload);
  if (!featureCollection) return null;
  const index = buildDaObjectionIndex(featureCollection);
  const firstDguid = String(primaryDguid ?? "");
  const secondDguid = String(secondaryDguid ?? "");
  const sharedBoundary = payload?.sharedBoundary?.type === "FeatureCollection"
    ? payload.sharedBoundary
    : getSharedBoundaryFeatureCollection(index, firstDguid, secondDguid);
  return {
    featureCollection,
    boundaryGeoJson: sharedBoundary,
    outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(index, [firstDguid, secondDguid]),
  };
}

function singleDaFromReleasePayload(payload, dguid) {
  const featureCollection = asFeatureCollection(payload);
  if (!featureCollection) return null;
  const index = buildDaObjectionIndex(featureCollection);
  const normalizedDguid = String(dguid ?? "");
  return {
    featureCollection,
    boundaryGeoJson: { type: "FeatureCollection", features: [] },
    outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(index, [normalizedDguid]),
  };
}

export async function loadSubmissionMapPresentation({
  submission,
  releaseId,
  primaryDguid,
  secondaryDguid,
  archivedDisplayGeometry = null,
  geometryView = "proposed",
  signal,
} = {}) {
  const type = normalizeSubmissionType(submission?.type);
  const resolvedReleaseId = String(releaseId ?? submission?.release_id ?? "").trim();
  const primary = String(primaryDguid ?? submission?.dguid ?? "").trim();
  const secondary = String(secondaryDguid ?? submission?.neighboring_dguid ?? "").trim();

  if (type === "counter-proposal" && archivedDisplayGeometry) {
    const fromArchive = buildArchivedDifferencePresentation(submission, {
      displayGeometry: archivedDisplayGeometry,
      originalGeometry: null,
      geometryView,
    });
    if (fromArchive && geometryView === "proposed") {
      return {
        ...fromArchive,
        impactSummary: submission?.validation_report ?? null,
        source: "archive-snapshot",
      };
    }
    if (resolvedReleaseId && primary && secondary && geometryView === "original") {
      const pairPayload = await mapApi.getReleaseDaPair(
        resolvedReleaseId,
        primary,
        secondary,
        { representation: "display", signal },
      );
      const pairGeometry = pairFromReleasePayload(pairPayload, primary, secondary);
      const fromRelease = buildArchivedDifferencePresentation(submission, {
        displayGeometry: archivedDisplayGeometry,
        originalGeometry: pairGeometry?.featureCollection ?? null,
        geometryView,
      });
      if (fromRelease) {
        return {
          ...fromRelease,
          impactSummary: submission?.validation_report ?? null,
          source: "immutable-release",
        };
      }
    }
  }

  if (type === "objection" && resolvedReleaseId && primary && secondary) {
    const pairPayload = await mapApi.getReleaseDaPair(
      resolvedReleaseId,
      primary,
      secondary,
      { representation: "display", signal },
    );
    const pairGeometry = pairFromReleasePayload(pairPayload, primary, secondary);
    if (!pairGeometry) {
      throw new Error("Unable to materialize objection pair geometry from the release.");
    }
    return {
      focusGeoJson: pairGeometry.featureCollection,
      objectionPreview: pairGeometry,
      counterProposalPreview: null,
      impactSummary: null,
      source: "immutable-release",
    };
  }

  if ((type === "feedback" || type === "comment") && resolvedReleaseId && primary) {
    const daPayload = await mapApi.getReleaseDa(
      resolvedReleaseId,
      primary,
      { representation: "display", signal },
    );
    const daGeometry = singleDaFromReleasePayload(daPayload, primary);
    if (!daGeometry) {
      throw new Error("Unable to materialize comment geometry from the release.");
    }
    return {
      focusGeoJson: daGeometry.featureCollection,
      objectionPreview: daGeometry,
      counterProposalPreview: null,
      impactSummary: null,
      source: "immutable-release",
    };
  }

  return null;
}
