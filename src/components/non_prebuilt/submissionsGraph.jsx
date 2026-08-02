import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import {
  SUBMISSION_STATUS_SERIES,
  buildSubmissionStatusTimeline,
} from "@/lib/submissions/analytics.js";
import {
  Card,
  CardAccent,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const chartConfig = Object.fromEntries(
  SUBMISSION_STATUS_SERIES.map((series) => [
    series.id,
    { label: series.label, color: series.color },
  ]),
);

export function SubmissionsGraph({ submissions = [] }) {
  const chartData = useMemo(
    () => buildSubmissionStatusTimeline(submissions),
    [submissions],
  );

  return (
    <Card className="max-w-none">
      <CardHeader>
        <CardAccent />
        <CardTitle>Submission Volume Over Time</CardTitle>
        <CardDescription>
          Daily intake grouped by the five current Workspace statuses.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        {chartData.length ? (
          <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
            <AreaChart data={chartData} margin={{ left: 4, right: 12, top: 12 }}>
              <defs>
                {SUBMISSION_STATUS_SERIES.map((series) => (
                  <linearGradient id={`fill-${series.id}`} key={series.id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={series.color} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={series.color} stopOpacity={0.12} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-CA", {
                  month: "short",
                  day: "numeric",
                })}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent indicator="dot" labelFormatter={(value) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-CA", {
                  month: "short",
                  day: "numeric",
                })} />}
              />
              {SUBMISSION_STATUS_SERIES.map((series) => (
                <Area
                  dataKey={series.id}
                  key={series.id}
                  type="monotone"
                  stackId="status"
                  fill={`url(#fill-${series.id})`}
                  stroke={series.color}
                />
              ))}
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        ) : (
          <p className="py-16 text-center text-sm text-[#5f6368]">No submitted records are available yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
