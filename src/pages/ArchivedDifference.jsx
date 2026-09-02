import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, MapPinned, RotateCcw } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArchivedSubmissionCard } from "@/components/non_prebuilt/ArchivedSubmissionCard.jsx";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { MapInfoPanelShell } from "@/components/non_prebuilt/MapInfoPanelShell.jsx";
import { useMapFullscreen } from "@/contexts/MapFullscreenContext.jsx";
import { buildArchiveTree, findArchiveVersion, normalizeArchiveType } from "@/lib/archiveTree.js";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import {
  buildDaObjectionIndex,
  getPairOuterBoundaryFeatureCollection,
  getSharedBoundaryFeatureCollection,
} from "@/lib/map/objectionWorkflow.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import { mapApi } from "@/services/mapApi.js";
import { hydrateWorkspaceSubmission } from "@/services/tempCounterProposal.js";
import {
  getArchivedMapSnapshot,
  getArchiveTreeRecords,
  getArchiveVersionGeometry,
  revertArchiveBranch,
} from "@/services/workspaceApi.js";
import "@/styles/map.css";
import "@/styles/workspace-review.css";
import "@/styles/archive-tree.css";

function counterProposalGeometryPresentation(submission, archivedGeometry, geometryView) {
  const originalFeatureCollection = submission?.geometry?.originalFeatureCollection ?? null;
  const proposedFeatureCollection = archivedGeometry
    ?? submission?.geometry?.proposedFeatureCollection
    ?? null;
  const featureCollection = geometryView === "original"
    ? originalFeatureCollection ?? proposedFeatureCollection
    : proposedFeatureCollection ?? originalFeatureCollection;
  if (!featureCollection) return {};
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

function mapPresentation(submission, archivedGeometry, geometryView = "proposed") {
  if (normalizeArchiveType(submission?.type) === "counter-proposal") {
    return counterProposalGeometryPresentation(submission, archivedGeometry, geometryView);
  }
  if (archivedGeometry) {
    return {
      objectionPreview: submission?.geometry ?? null,
      focusGeoJson: archivedGeometry,
    };
  }
  if (!submission?.geometry) return {};
  return {
    objectionPreview: submission.geometry,
    focusGeoJson: submission.geometry.featureCollection,
  };
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

async function hydrateArchivedSubmission(submission, profiles) {
  try {
    return await hydrateWorkspaceSubmission(submission, profiles);
  } catch {
    return submission;
  }
}

export default function ArchivedDifference() {
  const navigate = useNavigate();
  const { isFullscreen, toggle: toggleFullscreen } = useMapFullscreen();
  const { submissionId: versionId } = useParams();
  const [searchParams] = useSearchParams();
  const branchKey = searchParams.get("branch");
  const openOnly = searchParams.get("mode") === "open";
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [latestEntry, setLatestEntry] = useState(null);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [latestSubmission, setLatestSubmission] = useState(null);
  const [submissionsByVersionId, setSubmissionsByVersionId] = useState(() => new Map());
  const [selectedGeometry, setSelectedGeometry] = useState(null);
  const [latestGeometry, setLatestGeometry] = useState(null);
  const [view, setView] = useState(openOnly ? "latest" : "selected");
  const [geometryView, setGeometryView] = useState("proposed");
  const [status, setStatus] = useState(openOnly ? "Loading archived map..." : "Loading archived difference...");
  const [error, setError] = useState("");
  const [isReverting, setIsReverting] = useState(false);

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
        const selected = findArchiveVersion(categories, versionId);
        if (!selected || (branchKey && selected.branch.key !== branchKey)) {
          throw new Error("The selected archived version is no longer available.");
        }
        const latest = {
          category: selected.category,
          branch: selected.branch,
          version: selected.branch.latestVersion,
        };
        const branchEntries = selected.branch.versions.map((version) => ({
          category: selected.category,
          branch: selected.branch,
          version,
        }));
        const isCounterProposal = normalizeArchiveType(selected.version.submission?.type) === "counter-proposal";
        const [hydratedVersions, selectedGeometryPayload, latestGeometryPayload] = await Promise.all([
          Promise.all(branchEntries.map(async (entry) => ({
            id: entry.version.id,
            submission: await hydrateArchivedSubmission(entry.version.submission, profiles),
          }))),
          isCounterProposal
            ? getArchiveVersionGeometry(selected.version.versionId ?? selected.version.id)
            : Promise.resolve(null),
          isCounterProposal
            ? getArchiveVersionGeometry(latest.version.versionId ?? latest.version.id)
            : Promise.resolve(null),
        ]);
        if (!isMounted) return;
        const hydratedById = new Map(hydratedVersions.map(({ id, submission }) => [id, submission]));
        setSelectedEntry(selected);
        setLatestEntry(latest);
        setSubmissionsByVersionId(hydratedById);
        setSelectedSubmission(hydratedById.get(selected.version.id) ?? selected.version.submission);
        setLatestSubmission(hydratedById.get(latest.version.id) ?? latest.version.submission);
        setSelectedGeometry(selectedGeometryPayload?.displayGeometry ?? null);
        setLatestGeometry(latestGeometryPayload?.displayGeometry ?? null);
        setGeometryView("proposed");
        setStatus(openOnly ? "Archived map ready." : "Archived difference ready.");
      } catch (loadError) {
        if (isMounted) setError(loadError.message || "Archived version could not be loaded.");
      }
    }
    load();
    return () => { isMounted = false; };
  }, [branchKey, openOnly, versionId]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousBodyOverflow; };
  }, []);

  const activeSubmission = view === "latest" ? latestSubmission : selectedSubmission;
  const activeGeometry = view === "latest" ? latestGeometry : selectedGeometry;
  const activeEntry = view === "latest" ? latestEntry : selectedEntry;
  const presentation = useMemo(
    () => mapPresentation(activeSubmission, activeGeometry, geometryView),
    [activeGeometry, activeSubmission, geometryView],
  );
  const stableFocus = useMemo(
    () => mapPresentation(selectedSubmission, selectedGeometry, "original").focusGeoJson,
    [selectedGeometry, selectedSubmission],
  );

  if (error && !selectedEntry) {
    return <main className="archive-difference-error"><h1>Archived version unavailable</h1><p>{error}</p></main>;
  }
  if (!selectedEntry || !latestEntry) return null;
  const selectedIsLatest = selectedEntry.version.id === latestEntry.version.id;
  const isCounterProposal = normalizeArchiveType(activeSubmission?.type) === "counter-proposal";
  const versionCards = [...selectedEntry.branch.versions]
    .reverse()
    .map((version) => ({ category: selectedEntry.category, branch: selectedEntry.branch, version }));

  function submissionForEntry(entry) {
    return submissionsByVersionId.get(entry.version.id)
      ?? (entry.version.id === latestEntry.version.id ? latestSubmission : selectedSubmission);
  }

  function versionRole(entry) {
    const isLatest = entry.version.id === latestEntry.version.id;
    const isSelected = entry.version.id === selectedEntry.version.id;
    if (isLatest && isSelected) return `Latest / Selected · ${entry.version.label}`;
    if (isLatest) return `Latest · ${entry.version.label}`;
    if (isSelected) return `Selected · ${entry.version.label}`;
    return `History · ${entry.version.label}`;
  }

  async function revertSelectedVersion() {
    if (selectedIsLatest || isReverting) return;
    const confirmed = window.confirm(
      `Create a new latest version by reverting this branch to ${selectedEntry.version.label}?`,
    );
    if (!confirmed) return;
    setIsReverting(true);
    setError("");
    try {
      const snapshot = await getArchivedMapSnapshot();
      await revertArchiveBranch(selectedEntry.branch.key, selectedEntry.version.sourceSubmissionId, {
        versionId: selectedEntry.version.versionId,
        expectedBranchVersion: selectedEntry.branch.resourceVersion,
        expectedMapRevision: snapshot.archiveMapRevision,
      });
      navigate("/dashboard/archivedTree", { replace: true });
    } catch (revertError) {
      setError(revertError.message || "Unable to revert this archived version.");
      setIsReverting(false);
    }
  }

  return (
    <main className={`archive-difference-page${isFullscreen ? " map-dashboard--fullscreen" : ""}`}>
      <section className="archive-difference-map" aria-label={openOnly ? "Archived version map" : "Archived boundary difference map"}>
        <div className="sr-only" aria-live="polite">{status}</div>
        <MapCanvas
          isFullscreen={isFullscreen}
          selection={null}
          objectionPreview={presentation.objectionPreview}
          counterProposalPreview={presentation.counterProposalPreview}
          focusGeoJson={stableFocus}
          workflowFocusDguids={selectedEntry.branch.dguids}
          interactionMode={MAP_INTERACTION_MODE.COUNTER_REVIEW}
          onStatusChange={setStatus}
          onToggleFullscreen={toggleFullscreen}
        />
        {!openOnly && !selectedIsLatest ? (
          <div className="archive-map-version-toggle" role="group" aria-label="Archived map version">
            <button type="button" className={view === "latest" ? "is-active" : ""} onClick={() => setView("latest")}>Latest Version</button>
            <button type="button" className={view === "selected" ? "is-active" : ""} onClick={() => setView("selected")}>Selected Version</button>
          </div>
        ) : null}
        {isCounterProposal ? (
          <div className="archive-counter-proposal-comparison" role="group" aria-label="Boundary comparison">
            <button type="button" className={geometryView === "proposed" ? "is-active" : ""} onClick={() => setGeometryView("proposed")}>Proposed</button>
            <button type="button" className={geometryView === "original" ? "is-active" : ""} onClick={() => setGeometryView("original")}>Original</button>
          </div>
        ) : null}
      </section>
      <MapInfoPanelShell className="archive-difference-panel" ariaLabel="Archived version details">
        <div className="archive-difference-panel__content">
        <header>
          {openOnly ? <MapPinned aria-hidden="true" /> : <ArrowLeftRight aria-hidden="true" />}
          <div>
            <h1>{openOnly ? "Archived Map View" : "View Difference and Revert"}</h1>
            <p>{openOnly ? "Read-only latest branch geometry" : "Compare the selected history with the latest branch version"}</p>
          </div>
        </header>
        <dl>
          <dt>DA ID</dt><dd><code>{selectedEntry.branch.dguids.join(" / ")}</code></dd>
          <dt>Community Name</dt><dd>{selectedEntry.branch.communityName}</dd>
          <dt>Submission Type</dt><dd>{selectedEntry.category.title}</dd>
        </dl>
        <div className="archive-difference-versions archive-submission-card-stack">
          {versionCards.map((entry) => (
            <ArchivedSubmissionCard
              key={entry.version.id}
              entry={entry.version}
              submission={submissionForEntry(entry)}
              categoryLabel={entry.category.title}
              versionLabel={versionRole(entry)}
              isActive={activeEntry?.version.id === entry.version.id}
            />
          ))}
        </div>
        {error ? <p className="archive-difference-error-message" role="alert">{error}</p> : null}
        {!openOnly && !selectedIsLatest ? (
          <button type="button" className="archive-difference-revert" disabled={isReverting} onClick={revertSelectedVersion}>
            <RotateCcw aria-hidden="true" /> {isReverting ? "Creating latest version…" : `Revert to ${selectedEntry.version.label}`}
          </button>
        ) : null}
        <p className="archive-difference-note">
          {openOnly
            ? "This is the latest immutable version for this branch."
            : "Revert creates a new latest version; it never overwrites historical versions."}
        </p>
        </div>
      </MapInfoPanelShell>
    </main>
  );
}
