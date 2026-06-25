import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FeaturePlaceholder } from "@/components/non_prebuilt/FeaturePlaceholder.jsx";

export default function CommissionerWorkspace() {
  const navigate = useNavigate();

  return (
    <div className="commissioner-workspace">
      <div className="commissioner-workspace__toolbar">
        <Button
          variant="outline"
          onClick={() => navigate("/dashboard")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Button>
      </div>
      <FeaturePlaceholder title="Commissioner Workspace" />
    </div>
  );
}
