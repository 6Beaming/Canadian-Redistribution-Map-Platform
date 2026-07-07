"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, Line, XAxis } from "recharts"
import { Field, FieldLabel } from "@/components/ui/field"
import { DatePickerSimple } from "../ui/datePicker"
import {
    Card,
    CardAccent,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart"
import { subDays } from "date-fns"

export const description = "An interactive area chart"

const chartData = [
    { date: "2026-05-01", comment: 260, objection: 160, counterProposal: 88, all: 508 },
    { date: "2026-05-02", comment: 310, objection: 190, counterProposal: 105, all: 605 },
    { date: "2026-05-03", comment: 290, objection: 180, counterProposal: 99, all: 569 },
    { date: "2026-05-04", comment: 400, objection: 240, counterProposal: 132, all: 772 },
    { date: "2026-05-05", comment: 680, objection: 400, counterProposal: 220, all: 1300 },
    { date: "2026-05-06", comment: 690, objection: 410, counterProposal: 226, all: 1326 },
    { date: "2026-05-07", comment: 390, objection: 240, counterProposal: 132, all: 762 },
    { date: "2026-05-08", comment: 250, objection: 150, counterProposal: 82, all: 482 },
    { date: "2026-05-09", comment: 270, objection: 170, counterProposal: 94, all: 534 },
    { date: "2026-05-10", comment: 320, objection: 200, counterProposal: 110, all: 630 },
    { date: "2026-05-11", comment: 360, objection: 220, counterProposal: 121, all: 701 },
    { date: "2026-05-12", comment: 240, objection: 150, counterProposal: 82, all: 472 },
    { date: "2026-05-13", comment: 210, objection: 130, counterProposal: 72, all: 412 },
    { date: "2026-05-14", comment: 670, objection: 390, counterProposal: 215, all: 1275 },
    { date: "2026-05-15", comment: 690, objection: 400, counterProposal: 220, all: 1310 },
    { date: "2026-05-16", comment: 340, objection: 210, counterProposal: 116, all: 666 },
    { date: "2026-05-17", comment: 700, objection: 420, counterProposal: 231, all: 1351 },
    { date: "2026-05-18", comment: 330, objection: 200, counterProposal: 110, all: 640 },
    { date: "2026-05-19", comment: 250, objection: 150, counterProposal: 82, all: 482 },
    { date: "2026-05-20", comment: 200, objection: 120, counterProposal: 66, all: 386 },
    { date: "2026-05-21", comment: 190, objection: 110, counterProposal: 61, all: 361 },
    { date: "2026-05-22", comment: 180, objection: 100, counterProposal: 55, all: 335 },
    { date: "2026-05-23", comment: 280, objection: 170, counterProposal: 94, all: 544 },
    { date: "2026-05-24", comment: 300, objection: 180, counterProposal: 99, all: 579 },
    { date: "2026-05-25", comment: 260, objection: 160, counterProposal: 88, all: 508 },
    { date: "2026-05-26", comment: 240, objection: 140, counterProposal: 77, all: 457 },
    { date: "2026-05-27", comment: 620, objection: 360, counterProposal: 198, all: 1178 },
    { date: "2026-05-28", comment: 260, objection: 160, counterProposal: 88, all: 508 },
    { date: "2026-05-29", comment: 200, objection: 120, counterProposal: 66, all: 386 },
    { date: "2026-05-30", comment: 380, objection: 230, counterProposal: 127, all: 737 },
    { date: "2026-05-31", comment: 220, objection: 140, counterProposal: 77, all: 437 },

    { date: "2026-06-01", comment: 230, objection: 140, counterProposal: 77, all: 447 },
    { date: "2026-06-02", comment: 680, objection: 400, counterProposal: 220, all: 1300 },
    { date: "2026-06-03", comment: 210, objection: 130, counterProposal: 72, all: 412 },
    { date: "2026-06-04", comment: 640, objection: 380, counterProposal: 209, all: 1229 },
    { date: "2026-06-05", comment: 200, objection: 120, counterProposal: 66, all: 386 },
    { date: "2026-06-06", comment: 300, objection: 180, counterProposal: 99, all: 579 },
    { date: "2026-06-07", comment: 340, objection: 200, counterProposal: 110, all: 650 },
    { date: "2026-06-08", comment: 390, objection: 230, counterProposal: 127, all: 747 },
    { date: "2026-06-09", comment: 690, objection: 410, counterProposal: 226, all: 1326 },
    { date: "2026-06-10", comment: 220, objection: 130, counterProposal: 72, all: 422 },
    { date: "2026-06-11", comment: 180, objection: 110, counterProposal: 61, all: 351 },
    { date: "2026-06-12", comment: 700, objection: 420, counterProposal: 231, all: 1351 },
    { date: "2026-06-13", comment: 190, objection: 120, counterProposal: 66, all: 376 },
    { date: "2026-06-14", comment: 650, objection: 390, counterProposal: 215, all: 1255 },
    { date: "2026-06-15", comment: 320, objection: 200, counterProposal: 110, all: 630 },
    { date: "2026-06-16", comment: 360, objection: 210, counterProposal: 116, all: 686 },
    { date: "2026-06-17", comment: 690, objection: 400, counterProposal: 220, all: 1310 },
    { date: "2026-06-18", comment: 210, objection: 130, counterProposal: 72, all: 412 },
    { date: "2026-06-19", comment: 380, objection: 230, counterProposal: 127, all: 737 },
    { date: "2026-06-20", comment: 680, objection: 410, counterProposal: 226, all: 1316 },
    { date: "2026-06-21", comment: 260, objection: 160, counterProposal: 88, all: 508 },
    { date: "2026-06-22", comment: 320, objection: 190, counterProposal: 105, all: 615 },
    { date: "2026-06-23", comment: 700, objection: 420, counterProposal: 231, all: 1351 },
    { date: "2026-06-24", comment: 240, objection: 150, counterProposal: 82, all: 472 },
    { date: "2026-06-25", comment: 260, objection: 160, counterProposal: 88, all: 508 },
    { date: "2026-06-26", comment: 640, objection: 380, counterProposal: 209, all: 1229 },
    { date: "2026-06-27", comment: 680, objection: 410, counterProposal: 226, all: 1316 },
    { date: "2026-06-28", comment: 220, objection: 130, counterProposal: 72, all: 422 },
    { date: "2026-06-29", comment: 210, objection: 120, counterProposal: 66, all: 396 },
    { date: "2026-06-30", comment: 690, objection: 400, counterProposal: 220, all: 1310 },
];

const chartConfig = {
    visitors: {
        label: "Visitors",
    },
    comment: {
        label: "comment",
        color: "var(--chart-1)",
    },
    objection: {
        label: "objection",
        color: "var(--chart-2)",
    },
    counterProposal: {
        label: "counterProposal",
        color: "var(--chart-3)",
    },
    all: {
        label: "all",
        color: "var(--chart-4)",
    },
}

export function SubmissionsGraph() {
    const [dateStart, setDateStart] = React.useState(subDays(new Date(), 30))
    const [dateEnd, setDateEnd] = React.useState(new Date())

    const filteredData = chartData.filter((item) => {
        const cur_item_date = new Date(item.date)
        return (cur_item_date >= dateStart && cur_item_date < dateEnd)
    })

    return (
        <Card className="max-w-none">
            <CardHeader className="gap-6">
                <div className="flex flex-col gap-4">
                    <CardAccent />
                    <div className="grid gap-3">
                        <CardTitle>Submission Volume Over Time</CardTitle>
                        <CardDescription>
                            Showing total submissions from {dateStart.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} to
                            {" "}
                            {subDays(dateEnd, 1).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                        </CardDescription>
                    </div>
                </div>
                <div className="flex flex-col gap-4 md:flex-row md:flex-wrap">
                    <Field className="w-full max-w-44">
                        <FieldLabel htmlFor="date-picker-simple">Start Date</FieldLabel>
                        <DatePickerSimple date={dateStart} setDate={setDateStart} />
                    </Field>
                    <Field className="w-full max-w-44">
                        <FieldLabel htmlFor="date-picker-simple">End Date (Exclusive)</FieldLabel>
                        <DatePickerSimple date={dateEnd} setDate={setDateEnd} />
                    </Field>
                </div>
            </CardHeader>
            <CardContent className="pt-2">
                <ChartContainer
                    config={chartConfig}
                    className="aspect-auto h-[250px] w-full"
                >
                    <AreaChart data={filteredData}>
                        <defs>
                            <linearGradient id="fillcomment" x1="0" y1="0" x2="0" y2="1">
                                <stop
                                    offset="5%"
                                    stopColor="var(--color-comment)"
                                    stopOpacity={0.8}
                                />
                                <stop
                                    offset="95%"
                                    stopColor="var(--color-comment)"
                                    stopOpacity={0.1}
                                />
                            </linearGradient>
                            <linearGradient id="fillobjection" x1="0" y1="0" x2="0" y2="1">
                                <stop
                                    offset="5%"
                                    stopColor="var(--color-objection)"
                                    stopOpacity={0.8}
                                />
                                <stop
                                    offset="95%"
                                    stopColor="var(--color-objection)"
                                    stopOpacity={0.1}
                                />
                            </linearGradient>
                            <linearGradient id="fillcounterProposal" x1="0" y1="0" x2="0" y2="1">
                                <stop
                                    offset="5%"
                                    stopColor="var(--color-counterProposal)"
                                    stopOpacity={0.8}
                                />
                                <stop
                                    offset="95%"
                                    stopColor="var(--color-counterProposal)"
                                    stopOpacity={0.1}
                                />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            minTickGap={32}
                            tickFormatter={(value) => {
                                const date = new Date(value)
                                return date.toLocaleDateString("en-CA", {
                                    month: "short",
                                    day: "numeric",
                                })
                            }}
                        />
                        <ChartTooltip
                            cursor={false}
                            content={
                                <ChartTooltipContent
                                    labelFormatter={(value) => {
                                        return new Date(value).toLocaleDateString("en-CA", {
                                            month: "short",
                                            day: "numeric",
                                        })
                                    }}
                                    indicator="dot"
                                />
                            }
                        />
                        <Area
                            dataKey="comment"
                            type="natural"
                            fill="url(#fillcomment)"
                            stroke="var(--color-comment)"
                            stackId="a"
                        />
                        <Area
                            dataKey="objection"
                            type="natural"
                            fill="url(#fillobjection)"
                            stroke="var(--color-objection)"
                            stackId="a"
                        />
                        <Area
                            dataKey="counterProposal"
                            type="natural"
                            fill="url(#fillcounterProposal)"
                            stroke="var(--color-counterProposal)"
                            stackId="a"
                        />
                        <Line
                            dataKey="all"
                            type="natural"
                            stroke="var(--color-all)"
                            strokeOpacity={0.2}
                            strokeWidth={2}
                            dot={false}
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                    </AreaChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}
