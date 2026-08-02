import { useNavigate } from "react-router-dom";

import columns, { normalizeCommissionerStatus } from "./SubmissionsColumns";
import SubmissionsTable from "./SubmissionsTable";
import { getCommissionerSubmissionTableRows } from "@/services/submissionListsApi";
import { useEffect, useState } from "react";
import { RouteLoadingPage } from "@/components/non_prebuilt/RouteLoadingPage.jsx";

export default function DashBoardSubmissionsPage() {
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState([]);
  const [loadState, setLoadState] = useState({ loading: true, error: "" });

  // Fetch submissions
  useEffect(() => {
    async function loadSubmissions() {

      try {
        setLoadState({ loading: true, error: "" });
        const { items: data } = await getCommissionerSubmissionTableRows();

        setSubmissions(
          data.map((submission) => ({
            id: submission.id,
            submittedAt: submission.created_at,
            submittedBy: submission.profile?.email ?? "Unknown",
            type: submission.type,
            title: submission.title,
            community_name: submission.dissemination_areas?.community_name ?? "Unknown",
            status: normalizeCommissionerStatus(submission.status),
          }))

        );
      } catch (err) {
        console.error(err);
        setLoadState({ loading: false, error: err.message || "Unable to load submissions." });
        return;
      }
      setLoadState({ loading: false, error: "" });
    }

    loadSubmissions();
  }, []);

  if (loadState.loading) return <RouteLoadingPage label="Loading user submissions…" />;
  if (loadState.error) return <RouteLoadingPage error={loadState.error} />;

  return (
    <div className="px-[clamp(0.5rem,2vw,1.5rem)] py-[clamp(1rem,3vw,1.5rem)]">
      <div className="submissions-page__content flex flex-col gap-6">
        <div>
          <SubmissionsTable
            columns={columns}
            data={submissions}
            onOpenAnalytics={() => navigate("/dashboard/graphs")}
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
