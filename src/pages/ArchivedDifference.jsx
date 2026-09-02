import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, MapPinned, RotateCcw } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArchivedSubmissionCard } from "@/components/non_prebuilt/ArchivedSubmissionCard.jsx";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { MapInfoPanelShell } from "@/components/non_prebuilt/MapInfoPanelShell.jsx";
import { useMapFullscreen } from "@/contexts/MapFullscreenContext.jsx";
import { useRouteLoading } from "@/contexts/RouteLoadingContext.jsx";
import {
  ARCHIVE_CATEGORY_DEFINITIONS,
  getArchiveCategoryId,
  normalizeArchiveType,
} from "@/lib/archiveTree.js";
import {
  buildArchivedDifferencePresentation,
  canRenderArchivedDifferenceFromSnapshots,
} from "@/lib/archiveDifferencePresentation.js";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import { hydrateWorkspaceSubmission } from "@/services/tempCounterProposal.js";
import {
  getArchiveBranchView,
  revertArchiveBranch,
} from "@/services/workspaceApi.js";
import "@/styles/map.css";
import "@/styles/workspace-review.css";
import "@/styles/archive-tree.css";

function mapVersionCards(view) {
  const categoryId = getArchiveCategoryId(view.selectedVersion?.submission?.type);
  const category = ARCHIVE_CATEGORY_DEFINITIONS.find((entry) => entry.id === categoryId) ?? ARCHIVE_CATEGORY_DEFINITIONS[0];
  const branch = {
    key: view.branch.key,
    dguids: view.branch.dguids ?? [],
    communityName: view.branch.communityName,
    resourceVersion: view.branch.resourceVersion ?? 1,
    versions: (view.versions ?? []).map((version, index) => ({
      id: String(version.versionId ?? version.submission?.id),
      versionId: version.versionId,
      sourceSubmissionId: String(version.submission?.id ?? ""),
      label: `v${version.versionNumber || index + 1}`,
      mergedAt: version.mergedAt,
      mergedBy: version.mergedBy,
      submission: version.submission,
      record: version,
      isLatest: Boolean(version.isLatest),
      closingComment: version.closingComment ?? null,
      validationReport: version.validationReport ?? null,
    })),
  };
  branch.latestVersion = branch.versions.find((version) => version.isLatest)
    ?? branch.versions[branch.versions.length - 1]
    ?? null;

  const selectedVersion = branch.versions.find((version) => (
    String(version.versionId) === String(view.selectedVersion?.versionId)
    || String(version.id) === String(view.selectedVersion?.versionId)
  )) ?? branch.latestVersion;
  const latestVersion = branch.versions.find((version) => version.isLatest) ?? branch.latestVersion;

  return {
    category: { id: category.id, title: category.title },
    branch,
    selected: { category: { id: category.id, title: category.title }, branch, version: selectedVersion },
    latest: { category: { id: category.id, title: category.title }, branch, version: latestVersion },
  };
}

function mapPresentation(submission, displayGeometry, originalGeometry, geometryView = "proposed") {
  const hydratedOriginal = submission?.geometry?.originalFeatureCollection ?? null;
  const hydratedProposed = submission?.geometry?.proposedFeatureCollection ?? null;
  const fromSnapshots = buildArchivedDifferencePresentation(submission, {
    displayGeometry: displayGeometry ?? hydratedProposed,
    originalGeometry: originalGeometry ?? hydratedOriginal,
    geometryView,
  });
  if (fromSnapshots) {
    return fromSnapshots;
  }

  if (!submission?.geometry) {
    return {};
  }

  if (normalizeArchiveType(submission?.type) === "counter-proposal") {
    return buildArchivedDifferencePresentation(submission, {
      displayGeometry: submission.geometry.proposedFeatureCollection,
      originalGeometry: submission.geometry.originalFeatureCollection,
      geometryView,
    }) ?? {};
  }

  return {
    objectionPreview: submission.geometry,
    focusGeoJson: submission.geometry.featureCollection,
  };
}

async function hydrateActiveSubmission(submission, {
  displayGeometry,
  originalGeometry,
  profilesByDguid,
}) {
  if (!submission) return null;
  if (canRenderArchivedDifferenceFromSnapshots({ submission, displayGeometry, originalGeometry })) {
    return submission;
  }
  try {
    return await hydrateWorkspaceSubmission(submission, profilesByDguid);
  } catch {
    return submission;
  }
}

export default function ArchivedDifference() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signalRouteReady } = useRouteLoading() ?? {};
  const { isFullscreen, toggle: toggleFullscreen } = useMapFullscreen();
  const { submissionId: versionId } = useParams();
  const [searchParams] = useSearchParams();
  const branchKey = searchParams.get("branch");
  const openOnly = searchParams.get("mode") === "open";
  const profilesByDguid = location.state?.profilesByDguid instanceof Map
    ? location.state.profilesByDguid
    : null;
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [latestEntry, setLatestEntry] = useState(null);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [latestSubmission, setLatestSubmission] = useState(null);
  const [submissionsByVersionId, setSubmissionsByVersionId] = useState(() => new Map());
  const [selectedGeometry, setSelectedGeometry] = useState(null);
  const [latestGeometry, setLatestGeometry] = useState(null);
  const [selectedOriginalGeometry, setSelectedOriginalGeometry] = useState(null);
  const [latestOriginalGeometry, setLatestOriginalGeometry] = useState(null);
  const [archiveMapRevision, setArchiveMapRevision] = useState(0);
  const [view, setView] = useState(openOnly ? "latest" : "selected");
  const [geometryView, setGeometryView] = useState("proposed");
  const [status, setStatus] = useState(openOnly ? "Loading archived map..." : "Loading archived difference...");
  const [error, setError] = useState("");
  const [isReverting, setIsReverting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const branchView = await getArchiveBranchView(versionId, {
          branchKey,
          includeDifference: !openOnly,
        });
        const mapped = mapVersionCards(branchView);
        const selectedSameAsLatest = mapped.selected.version.id === mapped.latest.version.id;
        const hydrateOptions = {
          profilesByDguid,
          displayGeometry: branchView.selectedDisplayGeometry ?? null,
          originalGeometry: branchView.selectedOriginalGeometry ?? null,
        };
        const latestHydrateOptions = {
          profilesByDguid,
          displayGeometry: branchView.latestDisplayGeometry ?? branchView.selectedDisplayGeometry ?? null,
          originalGeometry: branchView.latestOriginalGeometry ?? branchView.selectedOriginalGeometry ?? null,
        };

        let selectedHydrated;
        let latestHydrated;
        if (selectedSameAsLatest) {
          selectedHydrated = await hydrateActiveSubmission(
            mapped.selected.version.submission,
            hydrateOptions,
          );
          latestHydrated = selectedHydrated;
        } else {
          [selectedHydrated, latestHydrated] = await Promise.all([
            hydrateActiveSubmission(mapped.selected.version.submission, hydrateOptions),
            hydrateActiveSubmission(mapped.latest.version.submission, latestHydrateOptions),
          ]);
        }
        if (!isMounted) return;

        const hydratedById = new Map(
          mapped.branch.versions.map((version) => [
            version.id,
            version.id === mapped.selected.version.id ? selectedHydrated : version.submission,
          ]),
        );
        hydratedById.set(mapped.latest.version.id, latestHydrated);

        setSelectedEntry(mapped.selected);
        setLatestEntry(mapped.latest);
        setSubmissionsByVersionId(hydratedById);
        setSelectedSubmission(selectedHydrated);
        setLatestSubmission(latestHydrated);
        setSelectedGeometry(branchView.selectedDisplayGeometry ?? null);
        setLatestGeometry(branchView.latestDisplayGeometry ?? null);
        setSelectedOriginalGeometry(branchView.selectedOriginalGeometry ?? null);
        setLatestOriginalGeometry(branchView.latestOriginalGeometry ?? branchView.selectedOriginalGeometry ?? null);
        setArchiveMapRevision(branchView.archiveMapRevision ?? 0);
        setGeometryView("proposed");
        setStatus(openOnly ? "Archived map ready." : "Archived difference ready.");
        signalRouteReady?.();
      } catch (loadError) {
        if (isMounted) {
          setError(loadError.message || "Archived version could not be loaded.");
          signalRouteReady?.();
        }
      }
    }
    load();
    return () => { isMounted = false; };
  }, [branchKey, openOnly, profilesByDguid, signalRouteReady, versionId]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousBodyOverflow; };
  }, []);

  const activeSubmission = view === "latest" ? latestSubmission : selectedSubmission;
  const activeGeometry = view === "latest" ? latestGeometry : selectedGeometry;
  const activeOriginalGeometry = view === "latest" ? latestOriginalGeometry : selectedOriginalGeometry;
  const activeEntry = view === "latest" ? latestEntry : selectedEntry;

  useEffect(() => {
    if (geometryView !== "original" || !activeSubmission) {
      return undefined;
    }
    if (normalizeArchiveType(activeSubmission.type) !== "counter-proposal") {
      return undefined;
    }
    if (activeOriginalGeometry || activeSubmission.geometry?.originalFeatureCollection) {
      return undefined;
    }

    let isMounted = true;
    hydrateWorkspaceSubmission(activeSubmission, profilesByDguid)
      .then((hydrated) => {
        if (!isMounted || !hydrated?.geometry?.originalFeatureCollection) return;
        const applyHydrated = (current) => (
          current && String(current.id) === String(hydrated.id)
            ? { ...current, geometry: hydrated.geometry }
            : current
        );
        if (view === "latest") {
          setLatestSubmission(applyHydrated);
        } else {
          setSelectedSubmission(applyHydrated);
        }
        setSubmissionsByVersionId((current) => {
          const next = new Map(current);
          const activeVersionId = view === "latest" ? latestEntry?.version.id : selectedEntry?.version.id;
          if (activeVersionId) next.set(activeVersionId, applyHydrated(next.get(activeVersionId) ?? hydrated));
          return next;
        });
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [
    activeOriginalGeometry,
    activeSubmission,
    geometryView,
    latestEntry?.version.id,
    profilesByDguid,
    selectedEntry?.version.id,
    view,
  ]);

  const presentationByView = useMemo(() => ({
    proposed: mapPresentation(activeSubmission, activeGeometry, activeOriginalGeometry, "proposed"),
    original: mapPresentation(activeSubmission, activeGeometry, activeOriginalGeometry, "original"),
  }), [activeGeometry, activeOriginalGeometry, activeSubmission]);
  const presentation = presentationByView[geometryView === "original" ? "original" : "proposed"];
  const stableFocus = useMemo(
    () => mapPresentation(
      selectedSubmission,
      selectedGeometry,
      selectedOriginalGeometry,
      "original",
    ).focusGeoJson,
    [selectedGeometry, selectedOriginalGeometry, selectedSubmission],
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
      await revertArchiveBranch(selectedEntry.branch.key, selectedEntry.version.sourceSubmissionId, {
        versionId: selectedEntry.version.versionId,
        expectedBranchVersion: selectedEntry.branch.resourceVersion,
        expectedMapRevision: archiveMapRevision,
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
