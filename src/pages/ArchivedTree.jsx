import { useEffect, useMemo, useRef, useState } from "react";
import { Download, GitFork, Search } from "lucide-react";
import { useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { ArchivedTreeCanvas } from "@/components/non_prebuilt/ArchivedTreeCanvas.jsx";
import { ArchivedTreePanel } from "@/components/non_prebuilt/ArchivedTreePanel.jsx";
import { getArchiveTreeRecordsStore } from "@/lib/archive/archiveTreeRecordsStore.js";
import {
  buildArchiveTree,
  filterArchiveTree,
  findArchiveVersion,
  getArchiveVersionRouteId,
} from "@/lib/archiveTree.js";
import { exportArchivedTreeJson } from "@/services/exportApi.js";
import { deleteArchiveBranch } from "@/services/workspaceApi.js";
import "@/styles/archive-tree.css";

export default function ArchivedTree() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isParked = Boolean(useMatch("/dashboard/archivedTree/:submissionId/difference"));
  const storeRef = useRef(getArchiveTreeRecordsStore());
  const wasParkedRef = useRef(isParked);
  const [records, setRecords] = useState(() => storeRef.current.getSnapshot().records);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(() => !storeRef.current.getSnapshot().loaded);
  const [error, setError] = useState(() => storeRef.current.getSnapshot().error);
  const [exportState, setExportState] = useState({ pending: false, error: "" });
  const selectedId = searchParams.get("selected");

  useEffect(() => {
    const store = storeRef.current;
    const apply = (snapshot) => {
      setRecords(snapshot.records);
      setError(snapshot.error);
    };
    apply(store.getSnapshot());
    return store.subscribe(apply);
  }, []);

  useEffect(() => {
    const store = storeRef.current;
    const hasCache = store.getSnapshot().loaded;
    if (!hasCache) setIsLoading(true);
    let cancelled = false;
    store.refresh({ silent: hasCache })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const wasParked = wasParkedRef.current;
    wasParkedRef.current = isParked;
    if (!wasParked || isParked) return undefined;
    storeRef.current.refresh({ silent: true }).catch(() => {});
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isParked]);

  const categories = useMemo(
    () => buildArchiveTree(records),
    [records],
  );
  const visibleCategories = useMemo(
    () => filterArchiveTree(categories, query),
    [categories, query],
  );
  const selection = useMemo(
    () => findArchiveVersion(categories, selectedId),
    [categories, selectedId],
  );
  const branchCount = categories.reduce((count, category) => count + category.branches.length, 0);
  const versionCount = categories.reduce(
    (count, category) => count + category.branches.reduce((sum, branch) => sum + branch.versions.length, 0),
    0,
  );

  function selectVersion(_category, _branch, version) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("selected", version.id);
      return next;
    }, { replace: true, state: location.state });
  }

  function clearSelection() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("selected");
      return next;
    }, { replace: true, state: location.state });
  }

  return (
    <main className="archive-tree-page" aria-labelledby="archive-tree-title" aria-hidden={isParked || undefined} inert={isParked || undefined}>
      <header className="archive-tree-toolbar">
        <div className="archive-tree-heading">
          <span><GitFork aria-hidden="true" /></span>
          <div>
            <h1 id="archive-tree-title">Archived Tree</h1>
            <p>Browse archived branches and restore historical submission versions.</p>
          </div>
        </div>
        <div className="archive-tree-controls">
          <label>
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search submissions by DA or Community Name..."
              aria-label="Search archived submissions"
            />
          </label>
          <button
            type="button"
            className="archive-export-button"
            disabled={exportState.pending}
            onClick={async () => {
              if (exportState.pending) return;
              setExportState({ pending: true, error: "" });
              try {
                await exportArchivedTreeJson();
                setExportState({ pending: false, error: "" });
              } catch (exportError) {
                setExportState({ pending: false, error: exportError.message || "Unable to export the Archived Tree." });
              }
            }}
          >
            <Download aria-hidden="true" /> {exportState.pending ? "Exporting…" : "Export JSON"}
          </button>
        </div>
      </header>

      {error ? <p className="archive-tree-notice" role="alert">{error}</p> : null}
      {exportState.error ? <p className="archive-tree-notice" role="alert">{exportState.error}</p> : null}
      <div className="archive-tree-summary" aria-live="polite">
        {isLoading ? "Loading archived submissions..." : `${branchCount} branches · ${versionCount} immutable versions`}
      </div>

      <div className="archive-tree-layout">
        <ArchivedTreeCanvas
          categories={visibleCategories}
          isLoading={isLoading}
          selectedVersionId={selectedId}
          onSelect={selectVersion}
          onOpenSuperRootMap={() => navigate("/dashboard?archivedMap=1", {
            state: { from: "/dashboard/archivedTree" },
          })}
        />
        <ArchivedTreePanel
          selection={selection}
          onClose={clearSelection}
          onOpenMap={(_category, branch, version) => navigate(
            `/dashboard/archivedTree/${encodeURIComponent(getArchiveVersionRouteId(version))}/difference?branch=${encodeURIComponent(branch.key)}&mode=open`,
            { state: { from: "/dashboard/archivedTree", branchKey: branch.key, versionId: getArchiveVersionRouteId(version) } },
          )}
          onViewDifference={(_category, branch, version) => navigate(
            `/dashboard/archivedTree/${encodeURIComponent(getArchiveVersionRouteId(version))}/difference?branch=${encodeURIComponent(branch.key)}`,
            { state: { from: "/dashboard/archivedTree", branchKey: branch.key, versionId: getArchiveVersionRouteId(version) } },
          )}
          onDeleteBranch={async (branch) => {
            await deleteArchiveBranch(branch.key, {
              branchId: branch.branchId,
              expectedBranchVersion: branch.resourceVersion,
            });
            clearSelection();
            await storeRef.current.refresh({ silent: true });
          }}
        />
      </div>
    </main>
  );
}
