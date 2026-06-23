import { useEffect, useState } from "react";
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

// AI generated dummy data
const submissions = [
  { id: "SUB-2026-0142", submittedAt: "2026-06-15T14:32:00", title: "District boundary correction request", status: "Under Review" },
  { id: "SUB-2026-0139", submittedAt: "2026-06-12T09:10:00", title: "Population data discrepancy report", status: "Approved" },
  { id: "SUB-2026-0131", submittedAt: "2026-06-08T17:45:00", title: "New polling station suggestion", status: "Rejected" },
  { id: "SUB-2026-0118", submittedAt: "2026-06-01T11:20:00", title: "Riding name change proposal", status: "Approved" },
  { id: "SUB-2026-0104", submittedAt: "2026-05-28T08:55:00", title: "Electoral district merger feedback", status: "Under Review" },
  { id: "SUB-2026-0098", submittedAt: "2026-05-20T10:15:00", title: "Boundary adjustment for rural areas", status: "Approved" },
  { id: "SUB-2026-0091", submittedAt: "2026-05-14T13:45:00", title: "Voter registration discrepancy", status: "Rejected" },
  { id: "SUB-2026-0085", submittedAt: "2026-05-10T09:30:00", title: "New constituency proposal for downtown core", status: "Under Review" },
  { id: "SUB-2026-0079", submittedAt: "2026-05-05T16:20:00", title: "Census data update request", status: "Approved" },
  { id: "SUB-2026-0072", submittedAt: "2026-04-28T11:00:00", title: "Polling station accessibility complaint", status: "Approved" },
  { id: "SUB-2026-0065", submittedAt: "2026-04-21T14:10:00", title: "District name correction", status: "Rejected" },
  { id: "SUB-2026-0058", submittedAt: "2026-04-15T08:45:00", title: "Population growth redistribution request", status: "Under Review" },
  { id: "SUB-2026-0051", submittedAt: "2026-04-08T12:30:00", title: "Electoral map revision suggestion", status: "Approved" },
  { id: "SUB-2026-0044", submittedAt: "2026-04-01T15:00:00", title: "Duplicate riding number report", status: "Rejected" },
  { id: "SUB-2026-0037", submittedAt: "2026-03-25T10:20:00", title: "Community boundary feedback", status: "Approved" },
  { id: "SUB-2026-0030", submittedAt: "2026-03-18T09:00:00", title: "Urban expansion redistricting request", status: "Under Review" },
  { id: "SUB-2026-0023", submittedAt: "2026-03-11T13:15:00", title: "Indigenous territory boundary concern", status: "Under Review" },
  { id: "SUB-2026-0016", submittedAt: "2026-03-04T11:45:00", title: "Incorrect DA code report", status: "Approved" },
  { id: "SUB-2026-0009", submittedAt: "2026-02-25T14:00:00", title: "Subdivision boundary overlap complaint", status: "Rejected" },
  { id: "SUB-2026-0002", submittedAt: "2026-02-18T09:30:00", title: "Initial riding boundary submission", status: "Approved" },
];

const statusStyles = {
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
  "Under Review": "bg-yellow-100 text-yellow-700",
};

const columns = [
  {
    accessorKey: "id",
    header: "Reference ID",
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.getValue("id")}</span>
    ),
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
    accessorKey: "title",
    header: "Title",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status");
      return (
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}>
          {status}
        </span>
      );
    },
  },
];

export default function MySubmissions() {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState([{ id: "submittedAt", desc: true }]);
  const { sessionStatus } = useAuth();

  useEffect(() => {
    if (sessionStatus === "signed-out") {
      navigate("/sign-in", { replace: true });
    }
  }, [navigate, sessionStatus]);

  const table = useReactTable({
    data: submissions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    initialState: { pagination: { pageSize: 7 } },
  });

  if (sessionStatus !== "signed-in") {
    return null;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
        <Table>
          <TableHeader className="bg-gray-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="font-semibold text-gray-700">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-gray-50 transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-gray-400">
                  No submissions yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
        </p>
        <div className="flex items-center gap-2">
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
  );
}
