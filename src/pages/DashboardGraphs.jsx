import { BarChart3, UserCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SubmissionsGraph } from "@/components/non_prebuilt/submissionsGraph.jsx";
import { Card, CardAccent, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRealtimeSubmissionId } from "@/lib/realtime/workspaceRealtime.js";
import { SUBMISSION_STATUS_SERIES } from "@/lib/submissions/analytics.js";
import { getCommissionerSubmissionListStore } from "@/lib/submissions/commissionerSubmissionListStore.js";
import {
  getCommissionerSubmissionAnalytics,
  getSubmissionTableRowById,
  subscribeCommissionerSubmissionTable,
} from "@/services/submissionListsApi.js";

function percent(value, total) {
  return total ? `${Math.round((value / total) * 100)}%` : "0%";
}

export default function DashboardGraphs() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const statusTotals = analytics?.byStatus ?? {};
  const totalSubmissions = analytics?.total ?? 0;
  const submissionCounts = useMemo(() => ({
    comments: analytics?.byType?.feedback ?? 0,
    objections: analytics?.byType?.objection ?? 0,
    counterProposals: analytics?.byType?.["counter-proposal"] ?? 0,
  }), [analytics]);

  useEffect(() => {
    let mounted = true;
    const store = getCommissionerSubmissionListStore();
    const abortController = new AbortController();

    async function loadAnalytics() {
      try {
        const payload = await getCommissionerSubmissionAnalytics();
        if (!mounted) return;
        setAnalytics(payload);
        setLoadError("");
      } catch (error) {
        if (mounted) setLoadError(error.message || "Unable to load submission analytics.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    const refreshAffectedSubmission = async ({ event, hints, resync }) => {
      const submissionId = getRealtimeSubmissionId({ event, hints });
      if (resync || !submissionId) {
        await store.reset();
      } else if (event?.entity === "submission" && event.operation === "delete") {
        store.removeItem(submissionId);
      } else {
        const row = await getSubmissionTableRowById(submissionId);
        if (row) store.upsertItem(row);
      }
      if (mounted) await loadAnalytics();
    };

    void store.ensureBootstrapped({ signal: abortController.signal });
    void loadAnalytics();

    const unsubscribe = subscribeCommissionerSubmissionTable({
      onInvalidate: refreshAffectedSubmission,
      onRecover: (payload) => refreshAffectedSubmission(payload),
    });

    return () => {
      mounted = false;
      abortController.abort();
      unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] overflow-y-auto bg-[linear-gradient(180deg,#f8fbff_0%,#eef5ff_100%)] px-4 py-6 md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="rounded-[28px] border border-[#d7e6fb] bg-white/92 p-6 shadow-[0_18px_42px_rgba(26,115,232,0.08)] backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#e8f0fe] px-3 py-1 text-sm font-semibold text-[#1a73e8]"><BarChart3 className="h-4 w-4" />Commissioner Analytics</div>
              <div className="space-y-2"><h1 className="text-3xl font-bold text-[#17324d] md:text-4xl">Graphs and Stats</h1><p className="max-w-2xl text-sm leading-6 text-[#5f6368] md:text-base">Live submission distribution and daily review volume from the Commissioner table.</p></div>
            </div>
          </div>
        </section>

        {loadError ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{loadError}</p> : null}
        <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="max-w-none">
            <CardHeader><CardAccent /><CardTitle>Total Submissions</CardTitle><CardDescription>All records currently available to this Commissioner.</CardDescription></CardHeader>
            <CardContent className="gap-3">
              <div className="text-5xl font-bold text-[#1a73e8]">{loading ? "—" : totalSubmissions}</div>
              <div className="mt-5 border-t pt-4">
                <div className="mb-3 text-sm font-semibold text-[#17324d]">
                  Submission Breakdown
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-blue-50 p-3 text-center">
                    <div className="text-xl font-bold text-blue-700">
                      {loading ? "—" : submissionCounts.comments}
                    </div>
                    <div className="text-xs text-gray-600">Comments</div>
                  </div>
                  <div className="rounded-lg bg-orange-50 p-3 text-center">
                    <div className="text-xl font-bold text-orange-700">
                      {loading ? "—" : submissionCounts.objections}
                    </div>
                    <div className="text-xs text-gray-600">Objections</div>
                  </div>
                  <div className="rounded-lg bg-purple-50 p-3 text-center">
                    <div className="text-xl font-bold text-purple-700">
                      {loading ? "—" : submissionCounts.counterProposals}
                    </div>
                    <div className="text-xs text-gray-600">Counter Proposals</div>
                  </div>
                </div>
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-full bg-[#eef8ef] px-3 py-1 text-sm font-semibold text-[#17682b]"><UserCheck className="h-4 w-4" />Active review cycle</div>
            </CardContent>
          </Card>
          <Card className="max-w-none"><CardHeader><CardAccent /><CardTitle>Workspace Status Distribution</CardTitle><CardDescription>Five current Submission statuses, calculated from live table rows.</CardDescription></CardHeader><CardContent className="gap-4"><div className="flex h-4 w-full overflow-hidden rounded-full bg-[#eef3fd]">{SUBMISSION_STATUS_SERIES.map((series) => <div key={series.id} title={`${series.label}: ${statusTotals[series.id] ?? 0}`} style={{ width: percent(statusTotals[series.id] ?? 0, totalSubmissions), backgroundColor: series.color }} />)}</div><div className="grid grid-cols-1 gap-2 text-sm font-medium text-[#5f6368] sm:grid-cols-2">{SUBMISSION_STATUS_SERIES.map((series) => <div className="flex items-center justify-between gap-3" key={series.id}><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />{series.label}</span><span>{loading ? "—" : `${statusTotals[series.id] ?? 0} (${percent(statusTotals[series.id] ?? 0, totalSubmissions)})`}</span></div>)}</div></CardContent></Card>
        </section>
        <SubmissionsGraph dailyTimeline={analytics?.daily ?? []} />
      </div>
    </div>
  );
}
