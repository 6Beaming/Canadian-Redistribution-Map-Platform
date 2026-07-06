import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FeaturePlaceholder } from "@/components/non_prebuilt/FeaturePlaceholder.jsx";

export default function UserProfile() {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-3xl mx-auto flex flex-col gap-6">
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => navigate("/users")}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to map
      </Button>
      <FeaturePlaceholder title="My Profile" />
    </div>
  );
}
