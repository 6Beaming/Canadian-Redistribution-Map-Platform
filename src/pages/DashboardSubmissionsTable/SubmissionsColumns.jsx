/* source from https://ui.shadcn.com/docs/components/radix/data-table#basic-table */

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ArrowUpDown } from "lucide-react"

/*Submission = {
  id: string
  referenceNumber: string
  type: "comment" | "objection" | "counterproposal"
  riding: string
  submittedBy: string
  date: string
  status: "received" | "under_review" | "addressed"
  sentiment: "support" | "oppose" | "neutral"
  summary: string
  body: string
}*/

const columns = [
    {
        id: "actions",
        cell: ({ row, table }) => {
            const submission = row.original

            return (
                <DropdownMenu>
                    <DropdownMenuTrigger className="min-w-[116px] px-4 py-2 text-[14px]">
                        Actions
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem
                            onClick={() => navigator.clipboard.writeText(submission.id)}
                        >
                            Copy submission ID
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onSelect={() => table.options.meta?.onReviewInWorkspace?.(submission)}
                        >
                            Review this in the workspace
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>View author of submission</DropdownMenuItem>
                        {submission.type === "comment" &&
                            <DropdownMenuItem>View detailed comment</DropdownMenuItem>
                        }
                        {submission.type === "objection" &&
                            <DropdownMenuItem>View detailed objection</DropdownMenuItem>
                        }
                        {submission.type === "counterproposal" &&
                            <DropdownMenuItem>View detailed counter proposal</DropdownMenuItem>
                        }
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
    {
        accessorKey: "id",
        header: "ID",
    },
    {
        accessorKey: "date",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Date
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
    },
    {
        accessorKey: "submittedBy",
        header: "Submitted By",
    },
    {
        accessorKey: "type",
        header: "Type",
    },
    {
        accessorKey: "community_name",
        header: "Community Name",
    },
    {
        accessorKey: "title",
        header: "Title",
    },
    {
        accessorKey: "status",
        header: "Status",
    },
]

export default columns
