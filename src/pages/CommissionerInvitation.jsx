import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FeaturePlaceholder } from "@/components/non_prebuilt/FeaturePlaceholder.jsx";

export default function CommissionerInvitation() {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-3xl mx-auto flex flex-col gap-6">
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => navigate("/dashboard")}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Button>
      <FeaturePlaceholder title="Invite a new colleague" />
    </div>
  );
}
