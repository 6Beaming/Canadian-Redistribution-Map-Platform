import * as React from "react";
import { Fragment } from "react";
import { BarChart3, Download } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DatePickerSimple } from "@/components/ui/datePicker";
import { subDays } from "date-fns";
import { exportCommissionerSubmissionsCsv } from "@/services/exportApi.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  commissionerStatusMessages,
  commissionerStatusStyles,
  normalizeCommissionerStatus,
} from "./SubmissionsColumns.jsx";

function getSubmissionTypeBucket(type) {
  const normalized = String(type ?? "").trim().toLowerCase().replaceAll("-", "_");

  if (["feedback", "comment", "comments"].includes(normalized)) return "comments";
  if (["objection", "objections"].includes(normalized)) return "objections";
  return "counterproposal";
}

function isWithinDateRange(value, dateStart, dateEnd) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const start = dateStart ? new Date(dateStart).setHours(0, 0, 0, 0) : Number.NEGATIVE_INFINITY;
  const end = dateEnd ? new Date(dateEnd).setHours(23, 59, 59, 999) : Number.POSITIVE_INFINITY;
  return timestamp >= start && timestamp <= end;
}

export default function SubmissionsTable({ columns, data, onOpenAnalytics, onRowClick }) {
  const [sorting, setSorting] = React.useState([]);
  const [columnFilters, setColumnFilters] = React.useState([]);
  const [dateStart, setDateStart] = React.useState(subDays(new Date(), 30));
  const [dateEnd, setDateEnd] = React.useState(new Date());
  const [hoveredRowId, setHoveredRowId] = React.useState(null);
  const [exportState, setExportState] = React.useState({ pending: false, error: "" });
  const [visibleSubmissions, setVisibleSubmissions] = React.useState({
    comments: true,
    objections: true,
    counterproposal: true,
  });

  const filteredData = React.useMemo(
    () => data.filter((submission) => (
      visibleSubmissions[getSubmissionTypeBucket(submission.type)]
      && isWithinDateRange(submission.submittedAt, dateStart, dateEnd)
    )),
    [data, dateEnd, dateStart, visibleSubmissions],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
    },
    initialState: { pagination: { pageSize: 10 } },
  });

  async function exportCsv() {
    if (exportState.pending) return;
    const submissionIds = table.getPrePaginationRowModel().rows
      .map((row) => String(row.original.id));
    setExportState({ pending: true, error: "" });
    try {
      await exportCommissionerSubmissionsCsv(submissionIds);
      setExportState({ pending: false, error: "" });
    } catch (error) {
      setExportState({
        pending: false,
        error: error.message || "Unable to export filtered submissions.",
      });
    }
  }

  return (
    <div className="min-w-0">
      <div className="commissioner-submissions-toolbar">
        <Input
          placeholder="Filter Community Name..."
          value={table.getColumn("community_name")?.getFilterValue() ?? ""}
          onChange={(event) =>
            table.getColumn("community_name")?.setFilterValue(event.target.value)
          }
          className="commissioner-submissions-toolbar__search"
        />
        <div className="commissioner-submissions-toolbar__date-group">
          <DatePickerSimple
            date={dateStart}
            setDate={setDateStart}
            className="commissioner-submissions-toolbar__control h-10"
          />
          <DatePickerSimple
            date={dateEnd}
            setDate={setDateEnd}
            className="commissioner-submissions-toolbar__control h-10"
          />
        </div>

        <div className="commissioner-submissions-toolbar__actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="commissioner-submissions-toolbar__control h-10"
              >
                Submission Type
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                className="capitalize"
                checked={visibleSubmissions.comments}
                onCheckedChange={(value) =>
                  setVisibleSubmissions((current) => ({ ...current, comments: value }))
                }
              >
                Comments
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                className="capitalize"
                checked={visibleSubmissions.objections}
                onCheckedChange={(value) =>
                  setVisibleSubmissions((current) => ({ ...current, objections: value }))
                }
              >
                Objections
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                className="capitalize"
                checked={visibleSubmissions.counterproposal}
                onCheckedChange={(value) =>
                  setVisibleSubmissions((current) => ({ ...current, counterproposal: value }))
                }
              >
                Counterproposal
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            variant="outline"
            className="commissioner-submissions-toolbar__control commissioner-submissions-toolbar__export h-10"
            disabled={exportState.pending}
            onClick={() => void exportCsv()}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exportState.pending ? "Preparing…" : "Export CSV"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="commissioner-submissions-toolbar__control commissioner-submissions-toolbar__analytics h-10"
            onClick={onOpenAnalytics}
          >
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Analytics
          </Button>
        </div>
      </div>

      {exportState.error ? (
        <p className="mb-3 text-sm text-red-700" role="alert">{exportState.error}</p>
      ) : null}

      <div className="submissions-table-shell rounded-md border">
        <Table className="min-w-[60rem]">
          <TableHeader className="bg-gray-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="h-12">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="h-12 px-3 font-semibold text-gray-700">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const status = normalizeCommissionerStatus(row.original.status);

                return (
                  <Fragment key={row.id}>
                    <TableRow
                      className="h-14 cursor-pointer transition-colors hover:bg-gray-50"
                      data-state={row.getIsSelected() && "selected"}
                      onClick={() => onRowClick?.(row.original)}
                      onMouseEnter={() => setHoveredRowId(row.id)}
                      onMouseLeave={() =>
                        setHoveredRowId((current) => (current === row.id ? null : current))
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="px-3 py-3">
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
                            className={`overflow-hidden rounded-full px-4 text-center font-medium shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all duration-200 ${
                              hoveredRowId === row.id
                                ? "max-h-12 translate-y-0 py-2 opacity-100"
                                : "max-h-0 -translate-y-1 py-0 opacity-0"
                            } ${commissionerStatusStyles[status]}`}
                          >
                            {commissionerStatusMessages[status]}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="submissions-pagination flex items-center justify-between py-4">
        <p className="text-gray-500">
          Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
        </p>
        <div className="submissions-pagination__actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
