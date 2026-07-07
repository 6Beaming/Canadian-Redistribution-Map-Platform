/* source from https://ui.shadcn.com/docs/components/radix/data-table#basic-table */


import { Button } from "@/components/ui/button"
import { ArrowUpDown } from "lucide-react"

/*audit_log = {
  created_at: string
  id: string
  user_id: string
  action: "new/edit/delete comment, new/edit/delete objection, new/edit/delete counterproposal, tag"
  target_id: string
  details: string
}*/

const columns = [
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
        accessorKey: "user_id",
        header: "User ID",
    },
    {
        accessorKey: "action",
        header: "Action",
    },
    {
        accessorKey: "target_id",
        header: "Target ID",
    },
    {
        accessorKey: "details",
        header: "Details",
    },
]

export default columns