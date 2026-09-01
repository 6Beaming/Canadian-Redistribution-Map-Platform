import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { MapInfoPanelShell } from "@/components/non_prebuilt/MapInfoPanelShell.jsx";
import { RouteLoadingPage } from "@/components/non_prebuilt/RouteLoadingPage.jsx";
import { useMapFullscreen } from "@/contexts/MapFullscreenContext.jsx";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import { normalizePublicSubmissionStatus } from "@/lib/submissions/publicStatus.js";
import {
  getSubmissionMapView,
  hydrateSubmissionMapView,
} from "@/services/submissionMapViewApi.js";
import "@/styles/map.css";
import "@/styles/submission-map-view.css";

function normalizeType(value) {
  return String(value ?? "feedback").toLowerCase().replaceAll("_", "-");
}

function displayType(value) {
  const type = normalizeType(value);
  if (type === "counter-proposal") return "Counter-Proposal";
  if (type === "objection") return "Boundary Objection";
  return "Comment";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function buildPresentation(submission, comparisonView) {
  if (!submission?.geometry) return {};
  if (normalizeType(submission.type) !== "counter-proposal") {
    return { objectionPreview: submission.geometry };
  }

  const original = comparisonView === "original";
  return {
    counterProposalPreview: {
      featureCollection: original
        ? submission.geometry.originalFeatureCollection
        : submission.geometry.proposedFeatureCollection,
      boundaryGeoJson: original
        ? submission.geometry.originalBoundaryGeoJson
        : submission.geometry.boundaryGeoJson,
      outerBoundaryGeoJson: original
        ? submission.geometry.originalOuterBoundaryGeoJson
        : submission.geometry.outerBoundaryGeoJson,
      editable: false,
    },
  };
}

function SubmissionDetails({ submission }) {
  const projection = submission.submissionProjection;
  const publicStatus = normalizePublicSubmissionStatus(projection.status);
  const impact = submission.geometry?.impacts
    ?? submission.mapDescriptor.impactSummary
    ?? null;

  return (
    <MapInfoPanelShell className="submission-map-panel" ariaLabel="Submission details">
      <div className="submission-map-panel__content">
        <header className="submission-map-panel__header">
          <p>{displayType(projection.type)}</p>
          <h1>{projection.title || "Untitled submission"}</h1>
          <span className={`submission-map-panel__status submission-map-panel__status--${publicStatus}`}>
            {publicStatus === "pending" ? "Pending" : "Received"}
          </span>
        </header>

        <dl className="submission-map-panel__details">
          <div><dt>Reference ID</dt><dd><code>{projection.id}</code></dd></div>
          <div><dt>Submitted by</dt><dd>{projection.author?.email || "—"}</dd></div>
          <div><dt>Submitted at</dt><dd>{formatDate(projection.createdAt)}</dd></div>
          <div><dt>Primary DA</dt><dd>{submission.mapDescriptor.primaryDguid || "—"}</dd></div>
          {submission.mapDescriptor.secondaryDguid ? (
            <div><dt>Neighbouring DA</dt><dd>{submission.mapDescriptor.secondaryDguid}</dd></div>
          ) : null}
        </dl>

        <section className="submission-map-panel__comment" aria-labelledby="submission-comment-title">
          <h2 id="submission-comment-title">Submission content</h2>
          <p>{projection.comment || "No content was provided."}</p>
        </section>

        {normalizeType(projection.type) === "counter-proposal" && impact ? (
          <section className="submission-map-panel__impact" aria-labelledby="submission-impact-title">
            <h2 id="submission-impact-title">Proposed boundary impact</h2>
            <pre>{JSON.stringify(impact, null, 2)}</pre>
          </section>
        ) : null}
      </div>
    </MapInfoPanelShell>
  );
}

export default function UserResumeSubmission() {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const { isFullscreen, toggle: toggleFullscreen } = useMapFullscreen();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [submission, setSubmission] = useState(null);
  const [comparisonView, setComparisonView] = useState("proposed");
  const [status, setStatus] = useState("Loading submission map…");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setSubmission(null);
    setError("");
    setComparisonView("proposed");

    Promise.resolve()
      .then(() => getSubmissionMapView(submissionId))
      .then(hydrateSubmissionMapView)
      .then((nextSubmission) => {
        if (!active) return;
        setSubmission(nextSubmission);
        setStatus("Submission map ready.");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError.message || "Unable to load this submission.");
      });

    return () => {
      active = false;
    };
  }, [loadAttempt, submissionId]);

  const presentation = useMemo(
    () => buildPresentation(submission, comparisonView),
    [comparisonView, submission],
  );
  const mapFocusGeoJson = useMemo(() => {
    if (!submission?.geometry) return null;
    return normalizeType(submission.type) === "counter-proposal"
      ? submission.geometry.originalFeatureCollection
        ?? submission.geometry.proposedFeatureCollection
      : submission.geometry.featureCollection;
  }, [submission]);
  const retry = useCallback(() => setLoadAttempt((current) => current + 1), []);

  if (error) {
    return <RouteLoadingPage error={error} onRetry={retry} />;
  }

  if (!submission) {
    return <RouteLoadingPage />;
  }

  const focusDguids = [
    submission.mapDescriptor.primaryDguid,
    submission.mapDescriptor.secondaryDguid,
  ].filter(Boolean);
  const isCounterProposal = normalizeType(submission.type) === "counter-proposal";

  return (
    <main className="submission-map-page map-page">
      <div className="map-workspace map-workspace--single-column">
        <div className={`map-dashboard submission-map-dashboard${isFullscreen ? " map-dashboard--fullscreen" : ""}`}>
          <section className="map-dashboard__main submission-map-main" aria-label="Read-only submission map">
            <div className="map-dashboard__map-wrap">
              <div className="sr-only" aria-live="polite">{status}</div>
              {submission.geometry ? (
                <MapCanvas
                  isFullscreen={isFullscreen}
                  selection={null}
                  objectionPreview={presentation.objectionPreview}
                  counterProposalPreview={presentation.counterProposalPreview}
                  focusGeoJson={mapFocusGeoJson}
                  workflowFocusDguids={focusDguids}
                  interactionMode={MAP_INTERACTION_MODE.SUBMISSION_READONLY}
                  loadSubmissionCount={false}
                  onStatusChange={setStatus}
                  onToggleFullscreen={toggleFullscreen}
                />
              ) : (
                <div className="submission-map-empty" role="status">
                  <strong>Map geometry unavailable</strong>
                  <p>{submission.geometryError || "This submission does not have a readable map geometry."}</p>
                  <button type="button" onClick={() => navigate("/submissions")}>Back to My Submissions</button>
                </div>
              )}
              {isCounterProposal && submission.geometry ? (
                <div className="submission-map-comparison" role="group" aria-label="Boundary comparison">
                  <button type="button" className={comparisonView === "proposed" ? "is-active" : ""} onClick={() => setComparisonView("proposed")}>Proposed</button>
                  <button type="button" className={comparisonView === "original" ? "is-active" : ""} onClick={() => setComparisonView("original")}>Original</button>
                </div>
              ) : null}
            </div>
          </section>
          <SubmissionDetails submission={submission} />
        </div>
      </div>
    </main>
  );
}
