import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, GitCompareArrows } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { buildArchiveTree, findArchiveVersion, normalizeArchiveType } from "@/lib/archiveTree.js";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import { mapApi } from "@/services/mapApi.js";
import { hydrateWorkspaceSubmission } from "@/services/tempCounterProposal.js";
import { getArchiveTreeRecords } from "@/services/tempWorkspace.js";
import { notifyRouteReady } from "@/components/non_prebuilt/RouteLoadingOverlay.jsx";
import "@/styles/map.css";
import "@/styles/workspace-review.css";
import "@/styles/archive-tree.css";

function mapPresentation(submission) {
  if (!submission?.geometry) return {};
  if (normalizeArchiveType(submission.type) === "counter-proposal") {
    return {
      counterProposalPreview: {
        featureCollection: submission.geometry.proposedFeatureCollection,
        boundaryGeoJson: submission.geometry.boundaryGeoJson,
        outerBoundaryGeoJson: submission.geometry.outerBoundaryGeoJson,
        editable: false,
      },
      focusGeoJson: submission.geometry.originalFeatureCollection
        ?? submission.geometry.proposedFeatureCollection,
    };
  }
  return {
    objectionPreview: submission.geometry,
    focusGeoJson: submission.geometry.featureCollection,
  };
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export default function ArchivedDifference() {
  const { submissionId } = useParams();
  const [searchParams] = useSearchParams();
  const branchKey = searchParams.get("branch");
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [latestEntry, setLatestEntry] = useState(null);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [latestSubmission, setLatestSubmission] = useState(null);
  const [view, setView] = useState("selected");
  const [status, setStatus] = useState("Loading archived difference...");
  const [error, setError] = useState("");

  useEffect(() => {
    if (error || (selectedEntry && latestEntry)) notifyRouteReady();
  }, [error, latestEntry, selectedEntry]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const [records, profilePayload] = await Promise.all([
          getArchiveTreeRecords(),
          mapApi.getDaProfiles(),
        ]);
        const profiles = buildProfileIndex(profilePayload).index;
        const categories = buildArchiveTree(records, profiles);
        const selected = findArchiveVersion(categories, submissionId);
        if (!selected || (branchKey && selected.branch.key !== branchKey)) {
          throw new Error("The selected archived version is no longer available.");
        }
        const latest = {
          category: selected.category,
          branch: selected.branch,
          version: selected.branch.latestVersion,
        };
        const [hydratedSelected, hydratedLatest] = await Promise.all([
          hydrateWorkspaceSubmission(selected.version.submission, profiles),
          hydrateWorkspaceSubmission(latest.version.submission, profiles),
        ]);
        if (!isMounted) return;
        setSelectedEntry(selected);
        setLatestEntry(latest);
        setSelectedSubmission(hydratedSelected);
        setLatestSubmission(hydratedLatest);
        setStatus("Archived difference ready.");
      } catch (loadError) {
        if (isMounted) setError(loadError.message || "Archived difference could not be loaded.");
      }
    }
    load();
    return () => { isMounted = false; };
  }, [branchKey, submissionId]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousBodyOverflow; };
  }, []);

  const activeSubmission = view === "latest" ? latestSubmission : selectedSubmission;
  const activeEntry = view === "latest" ? latestEntry : selectedEntry;
  const presentation = useMemo(() => mapPresentation(activeSubmission), [activeSubmission]);
  const stableFocus = useMemo(
    () => mapPresentation(selectedSubmission).focusGeoJson,
    [selectedSubmission],
  );

  if (error) {
    return <main className="archive-difference-error"><h1>Archived difference unavailable</h1><p>{error}</p></main>;
  }
  if (!selectedEntry || !latestEntry) return null;

  return (
    <main className="archive-difference-page">
      <section className="archive-difference-map" aria-label="Archived boundary difference map">
        <div className="sr-only" aria-live="polite">{status}</div>
        <MapCanvas
          selection={null}
          objectionPreview={presentation.objectionPreview}
          counterProposalPreview={presentation.counterProposalPreview}
          focusGeoJson={stableFocus}
          workflowFocusDguids={selectedEntry.branch.dguids}
          interactionMode={MAP_INTERACTION_MODE.COUNTER_REVIEW}
          onStatusChange={setStatus}
        />
        <div className="archive-map-version-toggle" role="group" aria-label="Archived map version">
          <button type="button" className={view === "latest" ? "is-active" : ""} onClick={() => setView("latest")}>Latest Version</button>
          <button type="button" className={view === "selected" ? "is-active" : ""} onClick={() => setView("selected")}>Selected Version</button>
        </div>
      </section>
      <aside className="archive-difference-panel">
        <header><ArrowLeftRight aria-hidden="true" /><div><h1>View Difference</h1><p>Read-only archived version comparison</p></div></header>
        <dl>
          <dt>DA ID</dt><dd><code>{selectedEntry.branch.dguids.join(" / ")}</code></dd>
          <dt>Community Name</dt><dd>{selectedEntry.branch.communityName}</dd>
          <dt>Submission Type</dt><dd>{selectedEntry.category.title}</dd>
        </dl>
        <div className="archive-difference-versions">
          {[latestEntry, selectedEntry].map((entry, index) => (
            <article className={activeEntry?.version.id === entry.version.id ? "is-active" : ""} key={`${entry.version.id}:${index}`}>
              <span><GitCompareArrows aria-hidden="true" /></span>
              <div><strong>{index === 0 ? "Latest Version" : "Selected Version"} · {entry.version.label}</strong><small>{formatDate(entry.version.mergedAt)}</small><small>Updated by {entry.version.mergedBy}</small></div>
            </article>
          ))}
        </div>
        <p className="archive-difference-note">This view is read-only. It contains no commissioner comment editor and changing the viewport toggle redraws only the archived GeoJSON overlay.</p>
      </aside>
    </main>
  );
}
