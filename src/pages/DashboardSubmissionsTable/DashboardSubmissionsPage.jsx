import { useNavigate } from "react-router-dom";

import columns from "./SubmissionsColumns"
import SubmissionsTable from "./SubmissionsTable"
import { getAllComments } from "@/services/commentsApi";
import { useEffect, useState } from "react";

export default function DashBoardSubmissionsPage() {
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState([]);

  // Fetch submissions
  useEffect(() => {
    async function loadSubmissions() {

      try {
        const data = await getAllComments();

        setSubmissions(
          data.map((submission) => ({
            id: submission.id,
            date: submission.created_at,
            submittedBy: submission.profile
              ? `${submission.profile.first_name} ${submission.profile.last_name}`
              : "Unknown",
            type: submission.type,
            title: submission.title,
            community_name: submission.dissemination_areas?.community_name ?? "Unknown",
            status: submission.status,
          }))

        );
      } catch (err) {
        console.error(err);
      }
    }

    loadSubmissions();
  }, []);

  return (
    <div className="px-4 py-6 md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div>
          <SubmissionsTable
            columns={columns}
            data={submissions}
            onRowClick={() => navigate("/dashboard/workspace")}
          />
        </div>
      </div>
    </div>
  )
}
