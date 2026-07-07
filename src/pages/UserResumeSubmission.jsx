import { useParams } from "react-router-dom";
import { FeaturePlaceholder } from "@/components/non_prebuilt/FeaturePlaceholder.jsx";

export default function UserResumeSubmission() {
  const { submissionId } = useParams();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <FeaturePlaceholder
        title={`Resume Submission: ${submissionId ?? "Pending"}`}
      />
    </div>
  );
}
