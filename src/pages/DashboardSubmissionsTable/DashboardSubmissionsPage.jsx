import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import columns, { normalizeCommissionerStatus } from "./SubmissionsColumns";
import SubmissionsTable from "./SubmissionsTable";
import {
  getSubmissionTableRowById,
  subscribeCommissionerSubmissionTable,
} from "@/services/submissionListsApi";
import {
  getRealtimeSubmissionId,
  reconcileCommissionerSubmissionView,
  revealCommissionerSubmissionRows,
} from "@/lib/realtime/workspaceRealtime.js";
import {
  COMMISSIONER_UI_PAGE_SIZE,
  DEFAULT_VISIBLE_SUBMISSION_TYPES,
} from "@/lib/submissions/commissionerListPaging.js";
import {
  createDefaultCommissionerTableFilters,
  filterCommissionerSubmissionsForTable,
  formatCommissionerFilterDate,
} from "@/lib/submissions/commissionerSubmissionListFilters.js";
import { getCommissionerSubmissionListStore } from "@/lib/submissions/commissionerSubmissionListStore.js";

function toTableSubmission(submission) {
  return {
    id: submission.id,
    submittedAt: submission.created_at,
    submittedBy: submission.profile?.email ?? "Unknown",
    type: submission.type,
    title: submission.title,
    community_name: submission.dissemination_areas?.community_name ?? "Unknown",
    status: normalizeCommissionerStatus(submission.status),
  };
}

function computePageStats(filteredItems, fullyExpanded, uiPageIndex) {
  const filteredCount = filteredItems.length;
  const nextOffset = (uiPageIndex + 1) * COMMISSIONER_UI_PAGE_SIZE;
  const hasNext = nextOffset < filteredCount || !fullyExpanded;
  const totalPages = fullyExpanded
    ? Math.max(1, Math.ceil(filteredCount / COMMISSIONER_UI_PAGE_SIZE))
    : null;

  return {
    hasNext,
    totalPages,
    exportCount: fullyExpanded ? filteredCount : null,
  };
}

export default function DashBoardSubmissionsPage() {
  const navigate = useNavigate();
  const defaultFilters = createDefaultCommissionerTableFilters();
  const storeRef = useRef(getCommissionerSubmissionListStore());
  const [submissionView, setSubmissionView] = useState({
    visibleRows: [],
    bufferedRows: [],
  });
  const [loadError, setLoadError] = useState("");
  const [tableFetching, setTableFetching] = useState(true);
  const [uiPageIndex, setUiPageIndex] = useState(0);
  const [hasNextUiPage, setHasNextUiPage] = useState(false);
  const [totalPages, setTotalPages] = useState(null);
  const [paginationSuffix, setPaginationSuffix] = useState("counting");
  const [serverFilters, setServerFilters] = useState(defaultFilters);
  const [visibleTypes, setVisibleTypes] = useState(() => ({ ...DEFAULT_VISIBLE_SUBMISSION_TYPES }));
  const [exportMatchCount, setExportMatchCount] = useState(null);
  const uiPageIndexRef = useRef(0);
  const visibleTypesRef = useRef(visibleTypes);
  const serverFiltersRef = useRef(serverFilters);
  const resyncTimerRef = useRef(null);
  const realtimeReadyRef = useRef(false);

  uiPageIndexRef.current = uiPageIndex;
  visibleTypesRef.current = visibleTypes;
  serverFiltersRef.current = serverFilters;

  const applyCacheToView = useCallback(({
    targetUiPageIndex = uiPageIndexRef.current,
    nextVisibleTypes = visibleTypesRef.current,
    nextServerFilters = serverFiltersRef.current,
    clearBuffered = false,
    endFetching = false,
  } = {}) => {
    const store = storeRef.current;
    const filtered = store.getFilteredForTable(nextServerFilters, nextVisibleTypes);
    const start = targetUiPageIndex * COMMISSIONER_UI_PAGE_SIZE;
    const pageRows = filtered.slice(start, start + COMMISSIONER_UI_PAGE_SIZE).map(toTableSubmission);
    const stats = computePageStats(
      filtered,
      store.isRangeFullyLoaded(nextServerFilters.createdFrom),
      targetUiPageIndex,
    );

    flushSync(() => {
      setUiPageIndex(targetUiPageIndex);
      setHasNextUiPage(stats.hasNext);
      setTotalPages(stats.totalPages);
      if (stats.exportCount != null) {
        setExportMatchCount(stats.exportCount);
      }
      setPaginationSuffix(
        store.isRangeFullyLoaded(nextServerFilters.createdFrom) ? "total" : "counting",
      );
      setSubmissionView((current) => ({
        visibleRows: pageRows,
        bufferedRows: clearBuffered ? [] : (current?.bufferedRows ?? []),
      }));
      if (endFetching) {
        setTableFetching(false);
      }
    });
  }, []);

  const runWithTableFetching = useCallback(async (task) => {
    setTableFetching(true);
    try {
      await task();
    } catch (error) {
      setTableFetching(false);
      throw error;
    }
  }, []);

  const navigateUiPage = useCallback(async (targetUiPageIndex, {
    nextVisibleTypes = visibleTypesRef.current,
    nextServerFilters = serverFiltersRef.current,
    clearBuffered = false,
  } = {}) => {
    const store = storeRef.current;
    const needsFetch = store.needsMoreForTablePage(
      targetUiPageIndex,
      nextServerFilters,
      nextVisibleTypes,
      COMMISSIONER_UI_PAGE_SIZE,
    );

    if (needsFetch) {
      await runWithTableFetching(async () => {
        await store.fetchNextBatchUrgent();
        applyCacheToView({
          targetUiPageIndex,
          nextVisibleTypes,
          nextServerFilters,
          clearBuffered,
          endFetching: true,
        });
      });
      return;
    }

    applyCacheToView({
      targetUiPageIndex,
      nextVisibleTypes,
      nextServerFilters,
      clearBuffered,
    });
  }, [applyCacheToView, runWithTableFetching]);

  const applyCacheToViewRef = useRef(applyCacheToView);
  applyCacheToViewRef.current = applyCacheToView;

  useEffect(() => {
    const store = storeRef.current;

    const unsubscribe = store.subscribe(() => {
      applyCacheToViewRef.current({ clearBuffered: false });
    });

    void (async () => {
      setTableFetching(true);
      try {
        await store.ensureBootstrapped();
        applyCacheToViewRef.current({ clearBuffered: true, endFetching: true });
        realtimeReadyRef.current = true;
      } catch (error) {
        setLoadError(error.message || "Unable to load submissions.");
        setTableFetching(false);
      }
    })();

    return () => {
      realtimeReadyRef.current = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let refreshQueue = Promise.resolve();

    function enqueueRefresh(refresh) {
      const result = refreshQueue.then(() => (isMounted ? refresh() : undefined));
      refreshQueue = result.catch(() => {});
      return result;
    }

    function scheduleResync(refresh) {
      window.clearTimeout(resyncTimerRef.current);
      resyncTimerRef.current = window.setTimeout(() => {
        void enqueueRefresh(refresh);
      }, 200);
    }

    async function refreshAffectedSubmission({ event, hints, resync }) {
      if (!realtimeReadyRef.current) return;

      const submissionId = getRealtimeSubmissionId({ event, hints });
      if (resync || !submissionId) {
        await storeRef.current.reset();
        if (!isMounted) return;
        applyCacheToViewRef.current({ clearBuffered: true });
        return;
      }

      try {
        const row = event.entity === "submission" && event.operation === "delete"
          ? null
          : await getSubmissionTableRowById(submissionId);
        if (!isMounted) return;
        setSubmissionView((current) => reconcileCommissionerSubmissionView(
          current,
          event,
          row ? toTableSubmission(row) : null,
          hints,
        ));
      } catch (err) {
        if (isMounted) {
          setLoadError(err.message || "Unable to refresh submissions.");
        }
        throw err;
      }
    }

    const unsubscribe = subscribeCommissionerSubmissionTable({
      onInvalidate: (payload) => enqueueRefresh(() => refreshAffectedSubmission(payload)),
      onRecover: (payload) => scheduleResync(() => refreshAffectedSubmission(payload)),
    });

    return () => {
      isMounted = false;
      window.clearTimeout(resyncTimerRef.current);
      unsubscribe();
    };
  }, []);

  return (
    <div className="px-[clamp(0.5rem,2vw,1.5rem)] py-[clamp(1rem,3vw,1.5rem)]">
      <div className="submissions-page__content flex flex-col gap-6">
        {loadError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {loadError}
          </p>
        ) : null}
        <div>
          <SubmissionsTable
            columns={columns}
            data={submissionView.visibleRows}
            newSubmissionCount={submissionView.bufferedRows.length}
            tableFetching={tableFetching}
            onOpenAnalytics={() => navigate("/dashboard/graphs")}
            onRevealNewSubmissions={() => {
              setSubmissionView((current) => revealCommissionerSubmissionRows(current));
            }}
            onRowClick={(submission) =>
              navigate(
                submission.status === "archived"
                  ? "/dashboard/archivedTree"
                  : `/dashboard/workspace?focus=${encodeURIComponent(submission.id)}`,
                { state: { from: "/dashboard/submissionsTable" } },
              )
            }
            serverPagination={{
              pageIndex: uiPageIndex,
              totalPages,
              paginationSuffix,
              hasPrevious: uiPageIndex > 0,
              hasNext: hasNextUiPage,
              onPrevious: () => {
                void navigateUiPage(Math.max(uiPageIndex - 1, 0));
              },
              onNext: () => {
                if (!hasNextUiPage) return;
                void navigateUiPage(uiPageIndex + 1);
              },
            }}
            serverFilters={{
              dateStart: serverFilters.dateStart,
              dateEnd: serverFilters.dateEnd,
              query: serverFilters.query,
            }}
            visibleTypes={visibleTypes}
            onVisibleTypesChange={(nextVisibleTypes) => {
              setVisibleTypes(nextVisibleTypes);
              void navigateUiPage(0, { nextVisibleTypes, clearBuffered: true });
            }}
            onServerFiltersChange={(nextFilters) => {
              const nextServerFilters = {
                dateStart: nextFilters.dateStart,
                dateEnd: nextFilters.dateEnd,
                createdFrom: formatCommissionerFilterDate(nextFilters.dateStart),
                createdTo: formatCommissionerFilterDate(nextFilters.dateEnd),
                query: String(nextFilters.query ?? "").trim(),
              };
              setServerFilters(nextServerFilters);
              setExportMatchCount(null);
              setUiPageIndex(0);
              void runWithTableFetching(async () => {
                try {
                  await storeRef.current.ensureDateCoverage(nextServerFilters.createdFrom);
                  applyCacheToView({
                    targetUiPageIndex: 0,
                    nextServerFilters,
                    clearBuffered: true,
                    endFetching: true,
                  });
                  setLoadError("");
                } catch (error) {
                  setLoadError(error.message || "Unable to load submissions.");
                }
              });
            }}
            onResolveExportIds={async (nextVisibleTypes) => {
              const store = storeRef.current;
              await store.waitUntilFullyExpanded();
              const filtered = filterCommissionerSubmissionsForTable(
                store.getItems(),
                serverFiltersRef.current,
                nextVisibleTypes,
              );
              setExportMatchCount(filtered.length);
              setTotalPages(Math.max(1, Math.ceil(filtered.length / COMMISSIONER_UI_PAGE_SIZE)));
              applyCacheToView({ nextVisibleTypes });
              return filtered.map((row) => String(row.id));
            }}
            exportMatchCount={exportMatchCount}
          />
        </div>
      </div>
    </div>
  );
}
