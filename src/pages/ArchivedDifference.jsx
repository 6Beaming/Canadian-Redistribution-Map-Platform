import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, GitCompareArrows, MapPinned, RotateCcw } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { buildArchiveTree, findArchiveVersion, normalizeArchiveType } from "@/lib/archiveTree.js";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
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

function mapPresentation(submission, archivedGeometry) {
  if (normalizeArchiveType(submission?.type) === "counter-proposal" && archivedGeometry) {
    return {
      counterProposalPreview: {
        featureCollection: archivedGeometry,
        editable: false,
      },
      focusGeoJson: archivedGeometry,
    };
  }
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
  const navigate = useNavigate();
  const { submissionId: versionId } = useParams();
  const [searchParams] = useSearchParams();
  const branchKey = searchParams.get("branch");
  const openOnly = searchParams.get("mode") === "open";
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [latestEntry, setLatestEntry] = useState(null);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [latestSubmission, setLatestSubmission] = useState(null);
  const [selectedGeometry, setSelectedGeometry] = useState(null);
  const [latestGeometry, setLatestGeometry] = useState(null);
  const [view, setView] = useState(openOnly ? "latest" : "selected");
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
        const isCounterProposal = normalizeArchiveType(selected.version.submission?.type) === "counter-proposal";
        const [hydratedSelected, hydratedLatest, selectedGeometryPayload, latestGeometryPayload] = await Promise.all([
          isCounterProposal
            ? Promise.resolve(selected.version.submission)
            : hydrateWorkspaceSubmission(selected.version.submission, profiles),
          isCounterProposal
            ? Promise.resolve(latest.version.submission)
            : hydrateWorkspaceSubmission(latest.version.submission, profiles),
          isCounterProposal && selected.version.versionId
            ? getArchiveVersionGeometry(selected.version.versionId)
            : Promise.resolve(null),
          isCounterProposal && latest.version.versionId
            ? getArchiveVersionGeometry(latest.version.versionId)
            : Promise.resolve(null),
        ]);
        if (!isMounted) return;
        setSelectedEntry(selected);
        setLatestEntry(latest);
        setSelectedSubmission(hydratedSelected);
        setLatestSubmission(hydratedLatest);
        setSelectedGeometry(selectedGeometryPayload?.displayGeometry ?? null);
        setLatestGeometry(latestGeometryPayload?.displayGeometry ?? null);
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
    () => mapPresentation(activeSubmission, activeGeometry),
    [activeGeometry, activeSubmission],
  );
  const stableFocus = useMemo(
    () => mapPresentation(selectedSubmission, selectedGeometry).focusGeoJson,
    [selectedGeometry, selectedSubmission],
  );

  if (error && !selectedEntry) {
    return <main className="archive-difference-error"><h1>Archived version unavailable</h1><p>{error}</p></main>;
  }
  if (!selectedEntry || !latestEntry) return null;
  const selectedIsLatest = selectedEntry.version.id === latestEntry.version.id;

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
    <main className="archive-difference-page">
      <section className="archive-difference-map" aria-label={openOnly ? "Archived version map" : "Archived boundary difference map"}>
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
        {!openOnly && !selectedIsLatest ? (
          <div className="archive-map-version-toggle" role="group" aria-label="Archived map version">
            <button type="button" className={view === "latest" ? "is-active" : ""} onClick={() => setView("latest")}>Latest Version</button>
            <button type="button" className={view === "selected" ? "is-active" : ""} onClick={() => setView("selected")}>Selected Version</button>
          </div>
        ) : null}
      </section>
      <aside className="archive-difference-panel">
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
        <div className="archive-difference-versions">
          {(openOnly || selectedIsLatest ? [latestEntry] : [latestEntry, selectedEntry]).map((entry, index) => (
            <article className={activeEntry?.version.id === entry.version.id ? "is-active" : ""} key={entry.version.id}>
              <span><GitCompareArrows aria-hidden="true" /></span>
              <div>
                <strong>{index === 0 ? "Latest Version" : "Selected Version"} · {entry.version.label}</strong>
                <small>{formatDate(entry.version.mergedAt)}</small>
                <small>Updated by {entry.version.mergedBy}</small>
              </div>
            </article>
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
            ? "This is the latest immutable geometry snapshot for this branch."
            : "Revert creates a new latest version; it never overwrites historical versions."}
        </p>
      </aside>
    </main>
  );
}
