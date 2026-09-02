import {
  buildDaObjectionIndex,
  getPairOuterBoundaryFeatureCollection,
  getSharedBoundaryFeatureCollection,
} from "@/lib/map/objectionWorkflow.js";
import { normalizeArchiveType } from "@/lib/archiveTree.js";

function asFeatureCollection(geometry) {
  if (!geometry) return null;
  if (geometry.type === "FeatureCollection") return geometry;
  if (geometry.type === "Feature") {
    return { type: "FeatureCollection", features: [geometry] };
  }
  return null;
}

function counterProposalPresentation(submission, displayGeometry, originalGeometry, geometryView) {
  const proposedFeatureCollection = asFeatureCollection(displayGeometry);
  const originalFeatureCollection = asFeatureCollection(originalGeometry) ?? proposedFeatureCollection;
  if (!proposedFeatureCollection && !originalFeatureCollection) {
    return null;
  }

  const featureCollection = geometryView === "original"
    ? originalFeatureCollection ?? proposedFeatureCollection
    : proposedFeatureCollection ?? originalFeatureCollection;
  const firstDguid = String(submission?.dguid ?? "");
  const secondDguid = String(submission?.neighboring_dguid ?? "");
  const index = buildDaObjectionIndex(featureCollection);

  return {
    counterProposalPreview: {
      featureCollection,
      boundaryGeoJson: getSharedBoundaryFeatureCollection(index, firstDguid, secondDguid),
      outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(index, [firstDguid, secondDguid]),
      editable: false,
    },
    focusGeoJson: originalFeatureCollection ?? proposedFeatureCollection,
  };
}

function boundaryPresentation(submission, displayGeometry) {
  const featureCollection = asFeatureCollection(displayGeometry);
  if (!featureCollection) {
    return null;
  }

  const firstDguid = String(submission?.dguid ?? "");
  const secondDguid = String(submission?.neighboring_dguid ?? "");
  const index = buildDaObjectionIndex(featureCollection);
  const isPair = Boolean(secondDguid);

  return {
    objectionPreview: isPair
      ? {
        featureCollection,
        boundaryGeoJson: getSharedBoundaryFeatureCollection(index, firstDguid, secondDguid),
        outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(index, [firstDguid, secondDguid]),
      }
      : {
        featureCollection,
        boundaryGeoJson: { type: "FeatureCollection", features: [] },
        outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(index, [firstDguid]),
      },
    focusGeoJson: featureCollection,
  };
}

export function buildArchivedDifferencePresentation(
  submission,
  {
    displayGeometry = null,
    originalGeometry = null,
    geometryView = "proposed",
  } = {},
) {
  if (!submission) {
    return null;
  }

  const type = normalizeArchiveType(submission?.type);
  if (type === "counter-proposal") {
    return counterProposalPresentation(submission, displayGeometry, originalGeometry, geometryView);
  }

  return boundaryPresentation(submission, displayGeometry);
}

export function canRenderArchivedDifferenceFromSnapshots({
  submission,
  displayGeometry,
  originalGeometry,
}) {
  if (!submission) {
    return false;
  }

  const type = normalizeArchiveType(submission?.type);
  if (type === "counter-proposal") {
    return Boolean(displayGeometry || originalGeometry);
  }

  return Boolean(displayGeometry);
}
