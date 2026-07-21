import { useNavigate } from "react-router-dom";

import columns, { normalizeCommissionerStatus } from "./SubmissionsColumns";
import SubmissionsTable from "./SubmissionsTable";
import { getCommissionerSubmissionRows } from "@/services/tempWorkspace.js";
import { useEffect, useState } from "react";

export default function DashBoardSubmissionsPage() {
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState([]);

  // Fetch submissions
  useEffect(() => {
    async function loadSubmissions() {

      try {
        const data = await getCommissionerSubmissionRows();

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
      }
    }

    loadSubmissions();
  }, []);

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
              )
            }
          />
        </div>
      </div>
    </div>
  )
}
