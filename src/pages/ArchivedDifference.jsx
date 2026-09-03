import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, MapPinned, RotateCcw } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArchivedSubmissionCard } from "@/components/non_prebuilt/ArchivedSubmissionCard.jsx";
import { MapInfoPanelShell } from "@/components/non_prebuilt/MapInfoPanelShell.jsx";
import { useArchivedMapLayout } from "@/contexts/ArchivedMapLayoutContext.jsx";
import { useRouteLoading } from "@/contexts/RouteLoadingContext.jsx";
import {
  ARCHIVE_CATEGORY_DEFINITIONS,
  getArchiveCategoryId,
  normalizeArchiveType,
} from "@/lib/archiveTree.js";
import { buildArchivedDifferencePresentation } from "@/lib/archiveDifferencePresentation.js";
import { mark, measure } from "@/lib/performanceMarks.js";
import { loadSubmissionMapPresentation } from "@/services/submissionMapPresentation.js";
import {
  getArchiveBranchView,
  revertArchiveBranch,
} from "@/services/workspaceApi.js";

function mapVersionCards(view) {
  const categoryId = getArchiveCategoryId(view.selectedVersion?.submission?.type);
  const category = ARCHIVE_CATEGORY_DEFINITIONS.find((entry) => entry.id === categoryId) ?? ARCHIVE_CATEGORY_DEFINITIONS[0];
  const branch = {
    key: view.branch.key,
    dguids: view.branch.dguids ?? [],
    communityName: view.branch.communityName,
    resourceVersion: view.branch.resourceVersion ?? 1,
    releaseId: view.branch.releaseId ?? null,
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
    String(version.versionId) === String(view.selectedVersionId ?? view.selectedVersion?.versionId)
    || String(version.id) === String(view.selectedVersionId ?? view.selectedVersion?.versionId)
  )) ?? branch.latestVersion;
  const latestVersion = branch.versions.find((version) => version.isLatest) ?? branch.latestVersion;

  return {
    category: { id: category.id, title: category.title },
    branch,
    selected: { category: { id: category.id, title: category.title }, branch, version: selectedVersion },
    latest: { category: { id: category.id, title: category.title }, branch, version: latestVersion },
    selectedVersionId: String(view.selectedVersionId ?? selectedVersion?.versionId ?? ""),
    latestVersionId: String(view.latestVersionId ?? latestVersion?.versionId ?? ""),
  };
}

function geometryEntryForVersion(geometryByVersionId, versionId) {
  if (!versionId) return null;
  return geometryByVersionId?.[String(versionId)] ?? null;
}

export default function ArchivedDifference() {
  const navigate = useNavigate();
  const { signalRouteReady } = useRouteLoading() ?? {};
  const { setMapFetching, updateMap, resetPresentationReady } = useArchivedMapLayout();
  const { submissionId: versionId } = useParams();
  const [searchParams] = useSearchParams();
  const branchKey = searchParams.get("branch");
  const openOnly = searchParams.get("mode") === "open";
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [latestEntry, setLatestEntry] = useState(null);
  const [geometryByVersionId, setGeometryByVersionId] = useState(() => ({}));
  const [presentationByVersionId, setPresentationByVersionId] = useState(() => new Map());
  const [archiveMapRevision, setArchiveMapRevision] = useState(0);
  const [view, setView] = useState(openOnly ? "latest" : "selected");
  const [geometryView, setGeometryView] = useState("proposed");
  const [status, setStatus] = useState(openOnly ? "Loading archived map..." : "Loading archived difference...");
  const [error, setError] = useState("");
  const [isReverting, setIsReverting] = useState(false);
  const routeReadySignaledRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const lastMapPresentationRef = useRef(null);
  const lastStableFocusRef = useRef(null);

  const signalRouteReadyOnce = useCallback(() => {
    if (routeReadySignaledRef.current) return;
    routeReadySignaledRef.current = true;
    mark("route-overlay-hidden");
    measure("route-overlay-hidden-after-map-idle", "map-first-idle", "route-overlay-hidden");
    signalRouteReady?.();
  }, [signalRouteReady]);

  const handleInitialPresentationReady = useCallback(() => {
    signalRouteReadyOnce();
  }, [signalRouteReadyOnce]);

  useEffect(() => {
    let isMounted = true;
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    routeReadySignaledRef.current = false;
    resetPresentationReady();
    setMapFetching(true);
    setError("");
    mark("route-navigation-start");

    async function loadPresentationForVersion({
      version,
      branch,
      geometryEntry,
      geometryViewMode,
    }) {
      const submission = version?.submission;
      if (!submission) return null;
      const releasePresentation = await loadSubmissionMapPresentation({
        submission,
        releaseId: branch.releaseId,
        primaryDguid: branch.dguids?.[0] ?? submission.dguid,
        secondaryDguid: branch.dguids?.[1] ?? submission.neighboring_dguid,
        archivedDisplayGeometry: geometryEntry?.displayGeometry ?? null,
        geometryView: geometryViewMode,
      });
      if (releasePresentation) {
        return releasePresentation;
      }
      return buildArchivedDifferencePresentation(submission, {
        displayGeometry: geometryEntry?.displayGeometry ?? null,
        originalGeometry: null,
        geometryView: geometryViewMode,
      });
    }

    async function load() {
      try {
        const branchView = await getArchiveBranchView(versionId, {
          branchKey,
          includeDifference: !openOnly,
        });
        mark("archive-view-response");
        if (!isMounted || generation !== loadGenerationRef.current) return;

        const mapped = mapVersionCards(branchView);
        const nextGeometryByVersionId = branchView.geometryByVersionId ?? {};
        setGeometryByVersionId(nextGeometryByVersionId);
        setSelectedEntry(mapped.selected);
        setLatestEntry(mapped.latest);
        setArchiveMapRevision(branchView.archiveMapRevision ?? 0);
        setGeometryView("proposed");
        setView(openOnly ? "latest" : "selected");

        const versionIdsToLoad = new Set([
          mapped.selectedVersionId,
          mapped.latestVersionId,
        ].filter(Boolean));

        const presentations = new Map();
        await Promise.all([...versionIdsToLoad].map(async (activeVersionId) => {
          const version = mapped.branch.versions.find((entry) => String(entry.versionId) === String(activeVersionId))
            ?? mapped.branch.versions.find((entry) => String(entry.id) === String(activeVersionId));
          if (!version) return;
          const presentation = await loadPresentationForVersion({
            version,
            branch: mapped.branch,
            geometryEntry: geometryEntryForVersion(nextGeometryByVersionId, activeVersionId),
            geometryViewMode: "proposed",
          });
          if (presentation) {
            presentations.set(String(activeVersionId), presentation);
          }
        }));

        if (!isMounted || generation !== loadGenerationRef.current) return;
        setPresentationByVersionId(presentations);
        setMapFetching(false);
        setError("");
        mark("map-presentation-data-ready");
        setStatus(openOnly ? "Archived map ready." : "Archived difference ready.");
      } catch (loadError) {
        if (!isMounted || generation !== loadGenerationRef.current) return;
        setMapFetching(false);
        setError(loadError.message || "Archived version could not be loaded.");
        signalRouteReadyOnce();
      }
    }
    load();
    return () => { isMounted = false; };
  }, [branchKey, openOnly, resetPresentationReady, setMapFetching, signalRouteReadyOnce, versionId]);

  const activeVersionId = view === "latest"
    ? String(latestEntry?.version.versionId ?? latestEntry?.version.id ?? "")
    : String(selectedEntry?.version.versionId ?? selectedEntry?.version.id ?? "");
  const activeEntry = view === "latest" ? latestEntry : selectedEntry;
  const activePresentation = presentationByVersionId.get(activeVersionId) ?? null;

  useEffect(() => {
    if (!activeEntry || geometryView !== "original") return undefined;
    if (normalizeArchiveType(activeEntry.version.submission?.type) !== "counter-proposal") {
      return undefined;
    }
    if (presentationByVersionId.get(`${activeVersionId}:original`)) {
      return undefined;
    }

    let isMounted = true;
    const generation = loadGenerationRef.current;
    (async () => {
      const geometryEntry = geometryEntryForVersion(geometryByVersionId, activeVersionId);
      const presentation = await loadSubmissionMapPresentation({
        submission: activeEntry.version.submission,
        releaseId: activeEntry.branch.releaseId,
        primaryDguid: activeEntry.branch.dguids?.[0],
        secondaryDguid: activeEntry.branch.dguids?.[1],
        archivedDisplayGeometry: geometryEntry?.displayGeometry ?? null,
        geometryView: "original",
      });
      if (!isMounted || generation !== loadGenerationRef.current || !presentation) return;
      setPresentationByVersionId((current) => {
        const next = new Map(current);
        next.set(`${activeVersionId}:original`, presentation);
        return next;
      });
    })().catch(() => {});
    return () => { isMounted = false; };
  }, [activeEntry, activeVersionId, geometryByVersionId, geometryView, presentationByVersionId]);

  const presentation = geometryView === "original"
    ? (presentationByVersionId.get(`${activeVersionId}:original`) ?? activePresentation)
    : activePresentation;

  const stableFocus = useMemo(() => {
    const selectedVersionId = String(selectedEntry?.version.versionId ?? selectedEntry?.version.id ?? "");
    const selectedPresentation = presentationByVersionId.get(selectedVersionId)
      ?? presentationByVersionId.get(`${selectedVersionId}:original`);
    return selectedPresentation?.focusGeoJson
      ?? buildArchivedDifferencePresentation(selectedEntry?.version.submission, {
        displayGeometry: geometryEntryForVersion(geometryByVersionId, selectedVersionId)?.displayGeometry ?? null,
        geometryView: "original",
      })?.focusGeoJson
      ?? null;
  }, [geometryByVersionId, presentationByVersionId, selectedEntry]);

  const mapPresentation = presentation ?? lastMapPresentationRef.current;
  const mapFocusGeoJson = stableFocus ?? lastStableFocusRef.current;
  if (presentation) {
    lastMapPresentationRef.current = presentation;
  }
  if (stableFocus) {
    lastStableFocusRef.current = stableFocus;
  }

  const selectedIsLatest = selectedEntry?.version.id === latestEntry?.version.id;
  const isCounterProposal = normalizeArchiveType(activeEntry?.version.submission?.type) === "counter-proposal";

  const mapControls = (
    <>
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
    </>
  );

  useEffect(() => {
    if (!selectedEntry || !latestEntry) return;
    updateMap({
      enabled: Boolean(mapPresentation),
      objectionPreview: mapPresentation?.objectionPreview ?? null,
      counterProposalPreview: mapPresentation?.counterProposalPreview ?? null,
      focusGeoJson: mapFocusGeoJson,
      workflowFocusDguids: selectedEntry.branch.dguids,
      status,
      presentationReadyKey: `${versionId}:${activeVersionId}:${geometryView}:${Boolean(mapPresentation)}`,
      mapControls,
      onPresentationReady: handleInitialPresentationReady,
    });
  }, [
    activeVersionId,
    geometryView,
    handleInitialPresentationReady,
    latestEntry,
    mapControls,
    mapFocusGeoJson,
    mapPresentation,
    selectedEntry,
    status,
    updateMap,
    versionId,
  ]);

  if (error && !selectedEntry) {
    return <main className="archive-difference-error"><h1>Archived version unavailable</h1><p>{error}</p></main>;
  }
  if (!selectedEntry || !latestEntry) {
    return null;
  }

  const versionCards = [...selectedEntry.branch.versions]
    .reverse()
    .map((version) => ({ category: selectedEntry.category, branch: selectedEntry.branch, version }));

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
    <MapInfoPanelShell className="archive-difference-panel archive-difference-panel--with-overlay" ariaLabel="Archived version details">
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
              submission={entry.version.submission}
              categoryLabel={entry.category.title}
              versionLabel={versionRole(entry)}
              isActive={activeEntry?.version.id === entry.version.id}
            />
          ))}
        </div>
        {error && selectedEntry ? <p className="archive-difference-error-message" role="alert">{error}</p> : null}
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
  );
}
