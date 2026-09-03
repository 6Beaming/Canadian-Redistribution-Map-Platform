import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { WorkspaceReviewPanel } from "@/components/non_prebuilt/WorkspaceReviewPanel.jsx";
import { mark, measure } from "@/lib/performanceMarks.js";
import { useWorkspaceMapLayout } from "@/contexts/WorkspaceMapLayoutContext.jsx";
import {
  getWorkspaceSubmissions,
  getWorkspaceReviewerEmails,
  normalizeWorkspaceStatus,
} from "@/services/workspaceApi";
import { getSubmissionTableRowById } from "@/services/submissionListsApi.js";
import { getSubmissionReviewContent } from "@/services/commentsApi.js";
import { hydrateWorkspaceSubmission } from "@/services/tempCounterProposal.js";
import { hydrateCommentObjectionFromRelease } from "@/services/submissionMapPresentation.js";
import { useRouteLoading } from "@/contexts/RouteLoadingContext.jsx";

function normalizeType(value) {
  return String(value ?? "feedback").toLowerCase().replaceAll("_", "-");
}

function branchKey(submission) {
  return `${normalizeType(submission.type)}:${normalizeWorkspaceStatus(submission.status)}`;
}

function buildMapPresentation(submission, comparisonView) {
  if (!submission?.geometry) {
    return {
      objectionPreview: null,
      counterProposalPreview: null,
      focusGeoJson: null,
    };
  }
  const isCounterProposal = normalizeType(submission.type) === "counter-proposal";
  if (isCounterProposal) {
    const isOriginal = comparisonView === "original";
    const featureCollection = isOriginal
      ? submission.geometry.originalFeatureCollection
      : submission.geometry.proposedFeatureCollection;
    return {
      objectionPreview: null,
      counterProposalPreview: {
        featureCollection,
        boundaryGeoJson: isOriginal
          ? submission.geometry.originalBoundaryGeoJson
          : submission.geometry.boundaryGeoJson,
        outerBoundaryGeoJson: isOriginal
          ? submission.geometry.originalOuterBoundaryGeoJson
          : submission.geometry.outerBoundaryGeoJson,
        editable: false,
      },
      focusGeoJson: submission.geometry.originalFeatureCollection
        ?? submission.geometry.proposedFeatureCollection
        ?? null,
    };
  }
  return {
    objectionPreview: submission.geometry,
    counterProposalPreview: null,
    focusGeoJson: submission.geometry.featureCollection ?? null,
  };
}

export default function WorkspaceReview() {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { signalRouteReady } = useRouteLoading() ?? {};
  const { setMapFetching, updateMap, resetPresentationReady } = useWorkspaceMapLayout();
  const routeReadySignaledRef = useRef(false);

  const handleInitialPresentationReady = useCallback(() => {
    if (routeReadySignaledRef.current) return;
    routeReadySignaledRef.current = true;
    mark("route-overlay-hidden");
    measure("route-overlay-hidden-after-map-idle", "map-first-idle", "route-overlay-hidden");
    signalRouteReady?.();
  }, [signalRouteReady]);

  const [submission, setSubmission] = useState(null);
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [reviewerEmails, setReviewerEmails] = useState([]);
  const [comparisonView, setComparisonView] = useState("proposed");
  const [mapFetching, setLocalMapFetching] = useState(true);
  const [status, setStatus] = useState("Loading submission workspace...");
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    routeReadySignaledRef.current = false;
    resetPresentationReady();
    setLocalMapFetching(true);
    setMapFetching(true);
    setError("");
    mark("route-navigation-start");
    async function load() {
      try {
        setStatus("Loading submission…");
        const activeRow = await getSubmissionTableRowById(submissionId);
        if (!activeRow) throw new Error("Submission not found in the active workspace.");
        if (isMounted) {
          setComparisonView("proposed");
          setStatus("Loading map detail…");
        }
        const reviewersPromise = getWorkspaceReviewerEmails().catch(() => []);
        const submissionType = normalizeType(activeRow.type);
        const contentPromise = submissionType === "counter-proposal"
          ? Promise.resolve(null)
          : getSubmissionReviewContent(activeRow.id).catch(() => null);
        const hydratePromise = submissionType === "counter-proposal"
          ? hydrateWorkspaceSubmission({ ...activeRow, source: "supabase" })
          : hydrateCommentObjectionFromRelease({ ...activeRow, source: "supabase" });
        const [reviewContent, hydrated] = await Promise.all([
          contentPromise,
          hydratePromise,
        ]);
        mark("map-presentation-data-ready");
        if (isMounted) {
          setSubmission({ ...hydrated, comment: reviewContent?.comment ?? hydrated.comment ?? "" });
          setLocalMapFetching(false);
          setMapFetching(false);
          setError("");
          setStatus("Submission map ready.");
        }
        Promise.all([
          getWorkspaceSubmissions({ includeArchived: false }),
          reviewersPromise,
        ])
          .then(([submissions, reviewers]) => {
            if (isMounted) {
              setAllSubmissions(submissions);
              setReviewerEmails(reviewers);
            }
          })
          .catch(() => {});
      } catch (loadError) {
        if (isMounted) {
          setLocalMapFetching(false);
          setMapFetching(false);
          setError(loadError.message);
        }
      }
    }
    load();
    return () => { isMounted = false; };
  }, [resetPresentationReady, setMapFetching, submissionId]);

  const panelReady = !mapFetching && String(submission?.id) === String(submissionId);
  const focusDguids = submission
    ? [submission.dguid, submission.neighboring_dguid].filter(Boolean)
    : [];

  const comparisonControls = panelReady && normalizeType(submission?.type) === "counter-proposal" ? (
    <div className="workspace-comparison-toggle" role="group" aria-label="Boundary comparison">
      <button type="button" className={comparisonView === "proposed" ? "is-active" : ""} onClick={() => setComparisonView("proposed")}>Proposed</button>
      <button type="button" className={comparisonView === "original" ? "is-active" : ""} onClick={() => setComparisonView("original")}>Original</button>
    </div>
  ) : null;

  useEffect(() => {
    if (!submission) return;
    const presentation = buildMapPresentation(submission, comparisonView);
    updateMap({
      enabled: Boolean(submission.geometry),
      objectionPreview: presentation.objectionPreview,
      counterProposalPreview: presentation.counterProposalPreview,
      focusGeoJson: presentation.focusGeoJson,
      workflowFocusDguids: focusDguids,
      geometryError: submission.geometry ? null : (submission.geometryError ?? null),
      status,
      presentationReadyKey: `${submissionId}:${comparisonView}:${Boolean(submission.geometry)}`,
      mapControls: comparisonControls,
      onPresentationReady: handleInitialPresentationReady,
    });
  }, [
    comparisonControls,
    comparisonView,
    focusDguids,
    handleInitialPresentationReady,
    submission,
    submissionId,
    status,
    updateMap,
  ]);

  const siblingSubmissions = useMemo(() => {
    if (!submission) return [];
    const key = branchKey(submission);
    return allSubmissions.filter((entry) => branchKey(entry) === key);
  }, [allSubmissions, submission]);

  function advanceAfterCommit() {
    const currentIndex = siblingSubmissions.findIndex((entry) => entry.id === submission.id);
    const next = siblingSubmissions[currentIndex + 1] ?? siblingSubmissions.find(
      (entry) => entry.id !== submission.id,
    );
    if (next) {
      toast.success("Submission resolved. Moving to the next submission.", {
        duration: 3000,
        className: "workspace-resolution-toast",
      });
      navigate(`/dashboard/workspace/${encodeURIComponent(next.id)}`, { state: location.state });
    } else {
      toast.success("Submission resolved. Returning to the Workspace.", {
        duration: 3000,
        className: "workspace-resolution-toast",
      });
      navigate("/dashboard/workspace", {
        state: { from: location.state?.workspaceFrom ?? null },
      });
    }
  }

  function updateSubmissionStatus(nextStatus) {
    const applyStatus = (current) => {
      if (!current || String(current.id) !== String(nextStatus?.submissionId)) return current;
      return {
        ...current,
        status: normalizeWorkspaceStatus(nextStatus.status),
        actual_status: nextStatus.actualStatus ?? current.actual_status ?? nextStatus.status,
        archive_request_status_hidden:
          nextStatus.archiveRequestStatusHidden
          ?? current.archive_request_status_hidden
          ?? false,
        archive_request_assigned_to_viewer:
          nextStatus.archiveRequestAssignedToViewer
          ?? current.archive_request_assigned_to_viewer
          ?? null,
        resource_version: Number(nextStatus.version) || current.resource_version,
        updated_at: nextStatus.updatedAt ?? current.updated_at,
        crossProvinceWarning: nextStatus.crossProvinceWarning ?? current.crossProvinceWarning,
        scope_pruids: nextStatus.eligibilityPruids ?? current.scope_pruids,
      };
    };
    setSubmission(applyStatus);
    setAllSubmissions((current) => current.map(applyStatus));
  }

  function handleCommitted(action, committed) {
    if (action === "archive-request") {
      updateSubmissionStatus(committed?.submissionStatus);
      return;
    }
    advanceAfterCommit();
  }

  if (error && !submission) {
    return <main className="workspace-review-error"><h1>Workspace unavailable</h1><p>{error}</p></main>;
  }
  if (!submission) {
    return null;
  }

  return (
    <div className="workspace-review-panel workspace-review-panel--with-overlay">
      {error && submission ? (
        <p className="workspace-review-panel__inline-error" role="alert">{error}</p>
      ) : null}
      <WorkspaceReviewPanel
        key={submission.id}
        submission={submission}
        siblingSubmissions={siblingSubmissions}
        onSubmissionSelect={(id) => navigate(`/dashboard/workspace/${encodeURIComponent(id)}`, {
          state: location.state,
        })}
        onCommitted={handleCommitted}
        onSubmissionUpdated={updateSubmissionStatus}
        reviewerEmails={reviewerEmails}
      />
    </div>
  );
}
