import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export const commissionerStatusStyles = {
  accepted: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  "archive-request": "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700",
  archived: "bg-purple-100 text-purple-700",
};

export const commissionerStatusMessages = {
  accepted: "View your colleagues' work for this in the shared workspace.",
  pending: "Start evaluating this in the shared workspace.",
  "archive-request": "Carefully evaluate whether this submission can be archived.",
  rejected: "Change your attitude towards this in the shared workspace.",
  archived: "View and rollback this committed submission in the archive tree.",
};

export function normalizeCommissionerStatus(status) {
  const normalized = String(status ?? "pending").trim().toLowerCase().replaceAll(" ", "_");

  if (["accepted", "approved", "addressed"].includes(normalized)) return "accepted";
  if (normalized === "rejected") return "rejected";
  if (["archive-request", "archive_request", "archive_requested"].includes(normalized)) {
    return "archive-request";
  }
  if (["archived", "achived", "archive"].includes(normalized)) return "archived";
  return "pending";
}

const sortableHeaderClassName = "-ml-3 h-auto px-3 py-2 font-semibold";

const columns = [
  {
    accessorKey: "id",
    header: "Reference ID",
    cell: ({ row }) => {
      const referenceId = String(row.getValue("id") ?? "");

      return (
        <span className="font-mono text-sm" title={referenceId}>
          {referenceId ? `${referenceId.slice(0, 5)}...` : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "submittedAt",
    header: ({ column }) => (
      <Button
        className={sortableHeaderClassName}
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Time of Submission
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <span className="text-sm text-gray-600">
        {new Date(row.getValue("submittedAt")).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "submittedBy",
    header: ({ column }) => (
      <Button
        className={sortableHeaderClassName}
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Submitted by
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    sortingFn: (left, right, columnId) =>
      String(left.getValue(columnId) ?? "").localeCompare(
        String(right.getValue(columnId) ?? ""),
        undefined,
        { sensitivity: "base" },
      ),
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
    cell: ({ row }) => {
      const title = String(row.getValue("title") ?? "").trim();
      const compactTitle = title.length > 10 ? `${title.slice(0, 10)}...` : title;

      return (
        <span className="inline-block max-w-[13ch] truncate align-bottom" title={title}>
          {compactTitle || "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = normalizeCommissionerStatus(row.getValue("status"));

      return (
        <span
          className={`inline-flex w-[clamp(6.5rem,10vw,8.25rem)] items-center justify-center rounded-full px-3 py-1 text-center font-medium ${commissionerStatusStyles[status]}`}
        >
          {status === "archive-request"
            ? "Archive Request"
            : status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      );
    },
  },
];

export default columns;
