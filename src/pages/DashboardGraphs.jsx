import { ArrowLeft, BarChart3, Files, UserCheck } from "lucide-react";
import { SubmissionsGraph } from "@/components/non_prebuilt/submissionsGraph";
import { Button } from "@/components/ui/button";
import { Card, CardAccent, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";

export default function DashboardGraphs() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[calc(100dvh-4rem)] overflow-y-auto bg-[linear-gradient(180deg,#f8fbff_0%,#eef5ff_100%)] px-4 py-6 md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="rounded-[28px] border border-[#d7e6fb] bg-white/92 p-6 shadow-[0_18px_42px_rgba(26,115,232,0.08)] backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#e8f0fe] px-3 py-1 text-sm font-semibold text-[#1a73e8]">
                <BarChart3 className="h-4 w-4" />
                Commissioner Analytics
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold text-[#17324d] md:text-4xl">
                  Graphs and Stats
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-[#5f6368] md:text-base">
                  Review submission volume, support trends, and objection activity in one dedicated analytics space without colliding with the map workspace.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => navigate("/dashboard")}
              >
                <ArrowLeft className="h-4 w-4" />
                Back To Map
              </Button>
              <Button onClick={() => navigate("/dashboard/submissionsTable")}>
                <Files className="h-4 w-4" />
                All Submission
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="max-w-none">
            <CardHeader>
              <CardAccent />
              <CardTitle>Total Submissions</CardTitle>
              <CardDescription>
                Consolidated intake across comments, objections, and counter-proposals.
              </CardDescription>
            </CardHeader>
            <CardContent className="gap-3">
              <div className="text-5xl font-bold text-[#1a73e8]">128</div>
              <div className="inline-flex w-fit items-center gap-2 rounded-full bg-[#eef8ef] px-3 py-1 text-sm font-semibold text-[#17682b]">
                <UserCheck className="h-4 w-4" />
                Active review cycle
              </div>
            </CardContent>
          </Card>

          <Card className="max-w-none">
            <CardHeader>
              <CardAccent />
              <CardTitle>Support vs Oppose</CardTitle>
              <CardDescription>
                Current sentiment split from the latest commissioner-facing sample set.
              </CardDescription>
            </CardHeader>
            <CardContent className="gap-4">
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-[#eef3fd]">
                <div className="bg-[#56b56a]" style={{ width: "68%" }} />
                <div className="bg-[#d23f31]" style={{ width: "32%" }} />
              </div>
              <div className="flex items-center justify-between text-sm font-medium text-[#5f6368]">
                <span>Support: 68%</span>
                <span>Oppose: 32%</span>
              </div>
            </CardContent>
          </Card>
        </section>

        <SubmissionsGraph />
      </div>
    </div>
  );
}
