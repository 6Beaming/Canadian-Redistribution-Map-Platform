import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { WorkspaceReviewPanel } from "@/components/non_prebuilt/WorkspaceReviewPanel.jsx";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import { mapApi } from "@/services/mapApi.js";
import {
  getWorkspaceSubmission,
  getWorkspaceSubmissions,
  getWorkspaceReviewerEmails,
  normalizeWorkspaceStatus,
} from "@/services/tempWorkspace.js";
import { notifyRouteReady } from "@/components/non_prebuilt/RouteLoadingOverlay.jsx";
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
  const [submission, setSubmission] = useState(null);
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [profilesByDguid, setProfilesByDguid] = useState(new Map());
  const [reviewerEmails, setReviewerEmails] = useState([]);
  const [comparisonView, setComparisonView] = useState("proposed");
  const [status, setStatus] = useState("Loading submission workspace...");
  const [error, setError] = useState("");

  useEffect(() => {
    if (submission || error) notifyRouteReady();
  }, [error, submission]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        setError("");
        const profilePayload = await mapApi.getDaProfiles();
        const { index } = buildProfileIndex(profilePayload);
        const [active, submissions, reviewers] = await Promise.all([
          getWorkspaceSubmission(submissionId, { profilesByDguid: index }),
          getWorkspaceSubmissions({ includeArchived: false }),
          getWorkspaceReviewerEmails().catch(() => []),
        ]);
        if (!active) throw new Error("Submission not found in the active workspace.");
        if (isMounted) {
          setProfilesByDguid(index);
          setSubmission(active);
          setAllSubmissions(submissions);
          setReviewerEmails(reviewers);
          setComparisonView("proposed");
          setStatus("Submission workspace ready.");
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
      navigate(`/dashboard/workspace/${encodeURIComponent(next.id)}`);
    } else {
      navigate(`/dashboard/workspace?focus=${encodeURIComponent(submission.id)}`);
    }
  }

  if (error) {
    return <main className="workspace-review-error"><h1>Workspace unavailable</h1><p>{error}</p></main>;
  }
  if (!submission) return null;

  return (
    <main className="workspace-review-page">
      <div className="workspace-review-layout">
        <section className="workspace-review-map" aria-label="Read-only submission map">
          <div className="sr-only" aria-live="polite">{status}</div>
          <MapCanvas
            selection={null}
            objectionPreview={mapPresentation.objectionPreview}
            counterProposalPreview={mapPresentation.counterProposalPreview}
            focusGeoJson={mapFocusGeoJson}
            workflowFocusDguids={focusDguids}
            interactionMode={MAP_INTERACTION_MODE.COUNTER_REVIEW}
            onStatusChange={setStatus}
          />
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
          onSubmissionSelect={(id) => navigate(`/dashboard/workspace/${encodeURIComponent(id)}`)}
          onCommitted={advanceAfterCommit}
          reviewerEmails={reviewerEmails}
          profilesByDguid={profilesByDguid}
        />
      </div>
    </main>
  );
}
