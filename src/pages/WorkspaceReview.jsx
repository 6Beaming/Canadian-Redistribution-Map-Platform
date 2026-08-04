import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { WorkspaceReviewPanel } from "@/components/non_prebuilt/WorkspaceReviewPanel.jsx";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import {
  getWorkspaceSubmissions,
  getWorkspaceReviewerEmails,
  normalizeWorkspaceStatus,
} from "@/services/workspaceApi";
import { getSubmissionTableRowById } from "@/services/submissionListsApi.js";
import { getSubmissionReviewContent } from "@/services/commentsApi.js";
import { hydrateWorkspaceSubmission } from "@/services/tempCounterProposal.js";
import { RouteLoadingPage } from "@/components/non_prebuilt/RouteLoadingPage.jsx";
import "@/styles/map.css";
import "@/styles/workspace-review.css";

function normalizeType(value) {
  return String(value ?? "feedback").toLowerCase().replaceAll("_", "-");
}

function branchKey(submission) {
  return `${normalizeType(submission.type)}:${normalizeWorkspaceStatus(submission.status)}`;
}

export default function WorkspaceReview() {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [submission, setSubmission] = useState(null);
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [reviewerEmails, setReviewerEmails] = useState([]);
  const [comparisonView, setComparisonView] = useState("proposed");
  const [status, setStatus] = useState("Loading submission workspace...");
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        setError("");
        setStatus("Loading submission…");
        setSubmission(null);
        setAllSubmissions([]);
        const activeRow = await getSubmissionTableRowById(submissionId);
        if (!activeRow) throw new Error("Submission not found in the active workspace.");
        if (isMounted) {
          setComparisonView("proposed");
          setStatus("Loading map detail…");
        }
        const reviewersPromise = getWorkspaceReviewerEmails().catch(() => []);
        const contentPromise = normalizeType(activeRow.type) === "counter-proposal"
          ? Promise.resolve(null)
          : getSubmissionReviewContent(activeRow.id).catch(() => null);
        const [reviewContent, hydrated] = await Promise.all([
          contentPromise,
          hydrateWorkspaceSubmission({ ...activeRow, source: "supabase" }),
        ]);
        if (isMounted) {
          setSubmission({ ...hydrated, comment: reviewContent?.comment ?? hydrated.comment ?? "" });
          setStatus("Submission map ready.");
        }
        const [submissions, reviewers] = await Promise.all([
          getWorkspaceSubmissions({ includeArchived: false }),
          reviewersPromise,
        ]);
        if (isMounted) {
          setAllSubmissions(submissions);
          setReviewerEmails(reviewers);
        }
      } catch (loadError) {
        if (isMounted) setError(loadError.message);
      }
    }
    load();
    return () => { isMounted = false; };
  }, [submissionId]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousBodyOverflow; };
  }, []);

  const siblingSubmissions = useMemo(() => {
    if (!submission) return [];
    const key = branchKey(submission);
    return allSubmissions.filter((entry) => branchKey(entry) === key);
  }, [allSubmissions, submission]);

  const mapPresentation = useMemo(() => {
    if (!submission?.geometry) return {};
    const isCounterProposal = normalizeType(submission.type) === "counter-proposal";
    if (isCounterProposal) {
      const isOriginal = comparisonView === "original";
      const featureCollection = isOriginal
        ? submission.geometry.originalFeatureCollection
        : submission.geometry.proposedFeatureCollection;
      return {
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
      };
    }
    return {
      objectionPreview: submission.geometry,
    };
  }, [comparisonView, submission]);

  // Keep the camera anchor independent of Original/Proposed. Switching the
  // view then updates only the already-mounted GeoJSON sources in MapCanvas.
  const mapFocusGeoJson = useMemo(() => {
    if (!submission?.geometry) return null;
    if (normalizeType(submission.type) === "counter-proposal") {
      return submission.geometry.originalFeatureCollection
        ?? submission.geometry.proposedFeatureCollection
        ?? null;
    }
    return submission.geometry.featureCollection ?? null;
  }, [submission]);

  const focusDguids = submission
    ? [submission.dguid, submission.neighboring_dguid].filter(Boolean)
    : [];

  function advanceAfterCommit() {
    const currentIndex = siblingSubmissions.findIndex((entry) => entry.id === submission.id);
    const next = siblingSubmissions[currentIndex + 1] ?? siblingSubmissions.find(
      (entry) => entry.id !== submission.id,
    );
    if (next) {
      navigate(`/dashboard/workspace/${encodeURIComponent(next.id)}`, { state: location.state });
    } else {
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
        resource_version: Number(nextStatus.version) || current.resource_version,
        updated_at: nextStatus.updatedAt ?? current.updated_at,
        crossProvinceWarning: nextStatus.crossProvinceWarning ?? current.crossProvinceWarning,
        scope_pruids: nextStatus.eligibilityPruids ?? current.scope_pruids,
      };
    };
    setSubmission(applyStatus);
    setAllSubmissions((current) => current.map(applyStatus));
  }

  if (error) {
    return <main className="workspace-review-error"><h1>Workspace unavailable</h1><p>{error}</p></main>;
  }
  if (!submission || String(submission.id) !== String(submissionId)) {
    return <RouteLoadingPage label="Loading submission workspace…" />;
  }

  return (
    <main className="workspace-review-page">
      <div className="workspace-review-layout">
        <section className="workspace-review-map" aria-label="Read-only submission map">
          <div className="sr-only" aria-live="polite">{status}</div>
          {submission.geometry ? (
            <MapCanvas
              selection={null}
              objectionPreview={mapPresentation.objectionPreview}
              counterProposalPreview={mapPresentation.counterProposalPreview}
              focusGeoJson={mapFocusGeoJson}
              workflowFocusDguids={focusDguids}
              interactionMode={MAP_INTERACTION_MODE.COUNTER_REVIEW}
              onStatusChange={setStatus}
            />
          ) : (
            <div className="route-loading-overlay__indicator" role="status">
              <span className="route-loading-overlay__spinner" aria-hidden="true" />
              <span>Loading map detail…</span>
            </div>
          )}
          {normalizeType(submission.type) === "counter-proposal" ? (
            <div className="workspace-comparison-toggle" role="group" aria-label="Boundary comparison">
              <button type="button" className={comparisonView === "proposed" ? "is-active" : ""} onClick={() => setComparisonView("proposed")}>Proposed</button>
              <button type="button" className={comparisonView === "original" ? "is-active" : ""} onClick={() => setComparisonView("original")}>Original</button>
            </div>
          ) : null}
        </section>
        <WorkspaceReviewPanel
          key={submission.id}
          submission={submission}
          siblingSubmissions={siblingSubmissions}
          onSubmissionSelect={(id) => navigate(`/dashboard/workspace/${encodeURIComponent(id)}`, {
            state: location.state,
          })}
          onCommitted={advanceAfterCommit}
          onSubmissionUpdated={updateSubmissionStatus}
          reviewerEmails={reviewerEmails}
        />
      </div>
    </main>
  );
}
