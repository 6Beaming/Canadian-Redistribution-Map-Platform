import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

import columns, { normalizeCommissionerStatus } from "./SubmissionsColumns";
import SubmissionsTable from "./SubmissionsTable";
import {
  getCommissionerSubmissionTableRows,
  getSubmissionTableRowById,
  subscribeCommissionerSubmissionTable,
} from "@/services/submissionListsApi";
import {
  getRealtimeSubmissionId,
  reconcileCommissionerSubmissionSnapshot,
  reconcileCommissionerSubmissionView,
  revealCommissionerSubmissionRows,
} from "@/lib/realtime/workspaceRealtime.js";
import { RouteLoadingPage } from "@/components/non_prebuilt/RouteLoadingPage.jsx";

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

export default function DashBoardSubmissionsPage() {
  const navigate = useNavigate();
  const [submissionView, setSubmissionView] = useState({
    visibleRows: [],
    bufferedRows: [],
  });
  const [loadState, setLoadState] = useState({ loading: true, error: "" });

  useEffect(() => {
    let isMounted = true;
    let refreshQueue = Promise.resolve();

    function enqueueRefresh(refresh) {
      const result = refreshQueue.then(() => isMounted ? refresh() : undefined);
      refreshQueue = result.catch(() => {});
      return result;
    }

    async function loadSubmissions({ replace = false, showLoading = false } = {}) {
      if (showLoading && isMounted) setLoadState({ loading: true, error: "" });
      try {
        const { items: data } = await getCommissionerSubmissionTableRows();
        if (!isMounted) return;
        const rows = data.map(toTableSubmission);
        setSubmissionView((current) => replace
          ? { visibleRows: rows, bufferedRows: [] }
          : reconcileCommissionerSubmissionSnapshot(current, rows));
        setLoadState({ loading: false, error: "" });
      } catch (err) {
        console.error(err);
        if (isMounted) {
          setLoadState({ loading: false, error: err.message || "Unable to load submissions." });
        }
        throw err;
      }
    }

    async function refreshAffectedSubmission({ event, hints, resync }) {
      const submissionId = getRealtimeSubmissionId({ event, hints });
      if (resync || !submissionId) {
        await loadSubmissions();
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
        setLoadState({ loading: false, error: "" });
      } catch (err) {
        if (isMounted) {
          setLoadState({ loading: false, error: err.message || "Unable to refresh submissions." });
        }
        throw err;
      }
    }

    const unsubscribe = subscribeCommissionerSubmissionTable({
      onInvalidate: (payload) => enqueueRefresh(() => refreshAffectedSubmission(payload)),
      onRecover: (payload) => enqueueRefresh(() => refreshAffectedSubmission(payload)),
    });
    void enqueueRefresh(() => loadSubmissions({ replace: true, showLoading: true })).catch(() => {});

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  if (loadState.loading) return <RouteLoadingPage />;
  if (loadState.error) return <RouteLoadingPage error={loadState.error} />;

  return (
    <div className="px-[clamp(0.5rem,2vw,1.5rem)] py-[clamp(1rem,3vw,1.5rem)]">
      <div className="submissions-page__content flex flex-col gap-6">
        <div>
          <SubmissionsTable
            columns={columns}
            data={submissionView.visibleRows}
            newSubmissionCount={submissionView.bufferedRows.length}
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
          />
        </div>
      </div>
    </div>
  )
}
