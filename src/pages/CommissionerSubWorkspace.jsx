import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FeaturePlaceholder } from "@/components/non_prebuilt/FeaturePlaceholder.jsx";

const ACTIVATION_NOTE =
  "This page shoule be activated when the commissioner select a specific user submission on the map.";

export default function CommissionerSubWorkspace() {
  const navigate = useNavigate();

  return (
    <>
      <FeaturePlaceholder title="Activate Shared Workspace" note={ACTIVATION_NOTE} />
      <Button
        className="w-full"
        onClick={() => navigate("/dashboard/workspace")}
      >
        Open in full workspace
      </Button>
    </>
  );
}
