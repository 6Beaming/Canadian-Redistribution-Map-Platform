import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FeaturePlaceholder } from "@/components/non_prebuilt/FeaturePlaceholder.jsx";

export default function UserResumeSubmission() {
  const navigate = useNavigate();
  const { submissionId } = useParams();

  return (
    <div className="p-6 max-w-3xl mx-auto flex flex-col gap-6">
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => navigate("/submissions")}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to submissions
      </Button>
      <FeaturePlaceholder
        title={`Resume Submission: ${submissionId ?? "—"}`}
      />
    </div>
  );
}
