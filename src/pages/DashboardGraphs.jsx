import { SubmissionsGraph } from "@/components/non_prebuilt/submissionsGraph"
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function DashboardGraphs() {
  const navigate = useNavigate();

  return (
    <div>
      <div className="w-full flex justify-center bg-white py-10 ">
        <h1 className="text-5xl font-bold text-primary">
          Graphs and Stats
        </h1>
      </div>
      <div className="px-15">
        <Button onClick={() => navigate(-1)}>
          Back
        </Button>
        <SubmissionsGraph></SubmissionsGraph>
      </div>
    </div>
  );
}