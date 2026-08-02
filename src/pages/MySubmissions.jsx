import { Fragment, useEffect, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getMySubmissionTableRows } from "@/services/submissionListsApi";
import { RouteLoadingPage } from "@/components/non_prebuilt/RouteLoadingPage.jsx";
import { normalizePublicSubmissionStatus } from "@/lib/submissions/publicStatus.js";

const statusStyles = {
  processed: "bg-green-100 px-3 py-1 text-green-700",
  pending: "bg-yellow-100 px-3 py-1 text-yellow-700",
};

const statusMessages = {
  processed: "Your submission has been processed. Thank you for your contribution.",
  pending: "We have informed the commissioners, please allow some time for them to review your submission.",
};

function normalizeSubmissionType(type) {
  const normalized = String(type ?? "feedback").trim().toLowerCase();

  if (normalized === "counter_proposal") {
    return "counter-proposal";
  }

  if (normalized === "comment") {
    return "feedback";
  }

  return normalized;
}

function formatSubmissionType(type) {
  const normalized = normalizeSubmissionType(type);

  if (normalized === "counter-proposal") {
    return "Counter-Proposal";
  }

  if (normalized === "objection") {
    return "Objection";
  }

  if (normalized === "feedback") {
    return "Feedback";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

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
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="-ml-3"
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
    cell: ({ row }) => {
      const status = row.getValue("status");
      return (
        <div className="flex justify-start">
          <span className={`inline-flex w-[132px] items-center justify-center rounded-full whitespace-nowrap text-center font-medium ${statusStyles[status]}`}>
            {status === "archive-request"
              ? "Archive Request"
              : status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
      );
    },
  },
];

export default function MySubmissions() {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState([{ id: "submittedAt", desc: true }]);
  const [hoveredRowId, setHoveredRowId] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const { sessionStatus, user } = useAuth();

  useEffect(() => {
    if (sessionStatus === "signed-out") {
      navigate("/sign-in", { replace: true });
    }
  }, [navigate, sessionStatus]);

  // Fetch submissions
  useEffect(() => {
    async function loadSubmissions() {
      if (sessionStatus !== "signed-in" || !user?.id) {
        return;
      }

      try {
        setIsLoading(true);
        setLoadError("");
        const { items: data } = await getMySubmissionTableRows();

        setSubmissions(
          data.map((submission) => ({
            id: submission.id,
            submittedAt: submission.created_at,
            type: formatSubmissionType(submission.type),
            title: submission.title,
            community_name: submission.dissemination_areas?.community_name ?? "Unknown",
            status: normalizePublicSubmissionStatus(submission.status),
          }))

        );
      } catch (err) {
        console.error(err);
        setLoadError(err.message || "Unable to load your submissions.");
      } finally {
        setIsLoading(false);
      }
    }

    loadSubmissions();
  }, [sessionStatus, user]);

  const table = useReactTable({
    data: submissions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    initialState: { pagination: { pageSize: 10 } },
  });

  if (sessionStatus !== "signed-in") {
    return null;
  }

  if (isLoading) return <RouteLoadingPage label="Loading your submissions…" />;

  return (
    <div className="px-[clamp(0.5rem,2vw,1.5rem)] py-[clamp(1rem,3vw,1.5rem)]">
      <div className="submissions-page__content flex flex-col gap-4">
        {loadError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}
        <div className="submissions-table-shell rounded-lg border border-gray-200 shadow-sm">
            <Table className="min-w-[60rem]">
              <TableHeader className="bg-gray-50">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="h-12">
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="h-12 px-3 text-[15px] font-semibold text-gray-700">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => {
                    const statusMessage = statusMessages[row.original.status];

                    return (
                      <Fragment key={row.id}>
                        <TableRow
                          className="h-14 cursor-default transition-colors hover:bg-gray-50"
                          onMouseEnter={() => setHoveredRowId(row.id)}
                          onMouseLeave={() => setHoveredRowId((current) => (current === row.id ? null : current))}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} className="px-3 py-3 text-[15px]">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow
                          aria-hidden="true"
                          className="pointer-events-none border-0 hover:bg-transparent"
                        >
                          <TableCell colSpan={columns.length} className="border-0 p-0">
                            <div className="flex justify-center overflow-hidden">
                              <div
                                className={`overflow-hidden rounded-full px-4 text-center text-sm font-medium shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all duration-200 ${hoveredRowId === row.id
                                  ? "max-h-10 translate-y-0 py-2 opacity-100"
                                  : "max-h-0 -translate-y-1 py-0 opacity-0"
                                  } ${statusStyles[row.original.status]}`}
                              >
                                {statusMessage}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 px-3 py-3 text-center text-[15px] text-gray-400">
                      No submissions yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
        </div>

          <div className="submissions-pagination flex items-center justify-between py-4">
            <p className="text-sm text-gray-500">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </p>
            <div className="submissions-pagination__actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
        </div>
      </div>
    </div>
  );
}
