import * as React from "react";
import { Fragment } from "react";
import { BarChart3, ChevronDown, Download } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  createDefaultCommissionerTableFilters,
  formatCommissionerFilterDate,
  parseCommissionerFilterDayBound,
} from "@/lib/submissions/commissionerSubmissionListFilters.js";
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
import {
  DEFAULT_VISIBLE_SUBMISSION_TYPES,
  getSubmissionTypeBucket,
} from "@/lib/submissions/commissionerListPaging.js";
import { PanelLoadingOverlay } from "@/components/non_prebuilt/LoadingIndicator.jsx";

function buildServerPageLabel(serverPagination) {
  const pageNumber = serverPagination.pageIndex + 1;
  const suffix = serverPagination.paginationSuffix ?? "counting";

  if (suffix === "counting") {
    return { pageNumber, counting: true };
  }
  if (suffix === "total" && serverPagination.totalPages) {
    return { text: `Page ${pageNumber} of ${serverPagination.totalPages}` };
  }
  return { text: `Page ${pageNumber}` };
}

function isWithinDateRange(value, dateStart, dateEnd) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const start = parseCommissionerFilterDayBound(dateStart, { endOfDay: false });
  const end = parseCommissionerFilterDayBound(dateEnd, { endOfDay: true });
  return timestamp >= start && timestamp <= end;
}

export default function SubmissionsTable({
  columns,
  data,
  newSubmissionCount = 0,
  onOpenAnalytics,
  onRevealNewSubmissions,
  onRowClick,
  serverPagination = null,
  serverFilters = null,
  onServerFiltersChange = null,
  visibleTypes: controlledVisibleTypes = null,
  onVisibleTypesChange = null,
  onResolveExportIds = null,
  exportMatchCount = null,
  tableFetching = false,
}) {
  const [sorting, setSorting] = React.useState([]);
  const [columnFilters, setColumnFilters] = React.useState([]);
  const [localDateStart, setLocalDateStart] = React.useState(
    () => createDefaultCommissionerTableFilters().dateStart,
  );
  const [localDateEnd, setLocalDateEnd] = React.useState(
    () => createDefaultCommissionerTableFilters().dateEnd,
  );
  const [localVisibleTypes, setLocalVisibleTypes] = React.useState({
    ...DEFAULT_VISIBLE_SUBMISSION_TYPES,
  });
  const [hoveredRowId, setHoveredRowId] = React.useState(null);
  const [exportState, setExportState] = React.useState({ pending: false, error: "" });
  const tableShellRef = React.useRef(null);

  const serverMode = Boolean(serverPagination);
  const dateStart = serverMode && serverFilters?.dateStart ? serverFilters.dateStart : localDateStart;
  const dateEnd = serverMode && serverFilters?.dateEnd ? serverFilters.dateEnd : localDateEnd;
  const visibleSubmissions = controlledVisibleTypes ?? localVisibleTypes;

  function updateVisibleTypes(next) {
    if (onVisibleTypesChange) {
      onVisibleTypesChange(next);
      return;
    }
    setLocalVisibleTypes(next);
  }

  function notifyServerFilters(next = {}) {
    if (!serverMode || !onServerFiltersChange) return;
    const communityQuery = columnFilters.find((filter) => filter.id === "community_name")?.value ?? "";
    onServerFiltersChange({
      dateStart: next.dateStart ?? dateStart,
      dateEnd: next.dateEnd ?? dateEnd,
      query: String(next.query ?? communityQuery).trim(),
    });
  }

  const filteredData = React.useMemo(
    () => data.filter((submission) => (
      visibleSubmissions[getSubmissionTypeBucket(submission.type)]
      && (serverMode || isWithinDateRange(submission.submittedAt, dateStart, dateEnd))
    )),
    [data, dateEnd, dateStart, serverMode, visibleSubmissions],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(serverMode ? { manualPagination: true } : { getPaginationRowModel: getPaginationRowModel() }),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
    },
    initialState: { pagination: { pageSize: serverMode ? filteredData.length || 10 : 10 } },
  });

  const filteredSubmissionCount = serverMode
    ? (exportMatchCount ?? "matching")
    : table.getPrePaginationRowModel().rows.length;

  function revealNewSubmissions() {
    if (!newSubmissionCount) return;
    table.setPageIndex(0);
    onRevealNewSubmissions?.();
    window.requestAnimationFrame(() => {
      tableShellRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function exportCsv() {
    if (exportState.pending) return;
    setExportState({ pending: true, error: "" });
    try {
      if (serverMode) {
        const communityQuery = columnFilters.find((filter) => filter.id === "community_name")?.value ?? "";
        await exportCommissionerSubmissionsCsv({
          filters: {
            createdFrom: formatCommissionerFilterDate(dateStart),
            createdTo: formatCommissionerFilterDate(dateEnd),
            query: String(serverFilters?.query ?? communityQuery ?? "").trim(),
          },
          types: visibleSubmissions,
        });
      } else {
        const submissionIds = table.getPrePaginationRowModel().rows.map((row) => String(row.original.id));
        await exportCommissionerSubmissionsCsv({ submissionIds });
      }
      setExportState({ pending: false, error: "" });
    } catch (error) {
      setExportState({
        pending: false,
        error: error.message || "Unable to export filtered submissions.",
      });
    }
  }

  const pageLabel = serverMode
    ? buildServerPageLabel(serverPagination)
    : { text: `Page ${table.getState().pagination.pageIndex + 1} of ${Math.max(table.getPageCount(), 1)}` };

  const showTableOverlay = tableFetching || exportState.pending;

  const exportCountLabel = filteredSubmissionCount === "matching"
    ? "all matching"
    : filteredSubmissionCount;

  return (
    <div className="relative min-w-0">
      {exportState.pending ? <PanelLoadingOverlay label="Loading..." /> : null}

      <div className="commissioner-submissions-toolbar">
        <Input
          placeholder="Filter Community Name..."
          value={serverMode
            ? (serverFilters?.query ?? "")
            : (table.getColumn("community_name")?.getFilterValue() ?? "")}
          onChange={(event) => {
            const query = event.target.value;
            if (!serverMode) {
              table.getColumn("community_name")?.setFilterValue(query);
            }
            notifyServerFilters({ query });
          }}
          className="commissioner-submissions-toolbar__search"
        />
        <div className="commissioner-submissions-toolbar__date-group">
          <DatePickerSimple
            date={dateStart}
            setDate={(nextDate) => {
              if (!serverMode) setLocalDateStart(nextDate);
              notifyServerFilters({ dateStart: nextDate });
            }}
            className="commissioner-submissions-toolbar__control h-10"
          />
          <DatePickerSimple
            date={dateEnd}
            setDate={(nextDate) => {
              if (!serverMode) setLocalDateEnd(nextDate);
              notifyServerFilters({ dateEnd: nextDate });
            }}
            className="commissioner-submissions-toolbar__control h-10"
          />
        </div>

        <div className="commissioner-submissions-toolbar__actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="commissioner-submissions-toolbar__control commissioner-submissions-toolbar__type h-10"
              >
                <span>Submission Type</span>
                <ChevronDown className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                className="capitalize"
                checked={visibleSubmissions.comments}
                onCheckedChange={(value) =>
                  updateVisibleTypes({ ...visibleSubmissions, comments: value })
                }
              >
                Comments
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                className="capitalize"
                checked={visibleSubmissions.objections}
                onCheckedChange={(value) =>
                  updateVisibleTypes({ ...visibleSubmissions, objections: value })
                }
              >
                Objections
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                className="capitalize"
                checked={visibleSubmissions.counterproposal}
                onCheckedChange={(value) =>
                  updateVisibleTypes({ ...visibleSubmissions, counterproposal: value })
                }
              >
                Counterproposal
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="commissioner-submissions-toolbar__control commissioner-submissions-toolbar__export h-10"
                disabled={exportState.pending}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {exportState.pending ? "Preparing…" : "Export CSV"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Export filtered submissions?</AlertDialogTitle>
                <AlertDialogDescription>
                  Do you want to download {filteredSubmissionCount}{" "}
                  {filteredSubmissionCount === 1 ? "submission" : "submissions"} based on
                  the current filters? Associated tags will be included.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void exportCsv()}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download CSV
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

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

      {newSubmissionCount > 0 ? (
        <div
          className="pointer-events-none sticky top-2 z-20 mb-3 flex justify-center"
          aria-live="polite"
        >
          <Button
            type="button"
            size="sm"
            className="pointer-events-auto rounded-full bg-blue-600 px-4 text-white shadow-lg hover:bg-blue-700"
            onClick={revealNewSubmissions}
          >
            {newSubmissionCount} new {newSubmissionCount === 1 ? "submission" : "submissions"}
          </Button>
        </div>
      ) : null}

      <div ref={tableShellRef} className="submissions-table-shell relative rounded-md border">
        {showTableOverlay && !exportState.pending ? <PanelLoadingOverlay label="Loading..." /> : null}
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
            ) : showTableOverlay ? (
              <TableRow aria-hidden="true">
                <TableCell colSpan={columns.length} className="h-24" />
              </TableRow>
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
        <p className="submissions-pagination__label text-gray-500">
          {pageLabel.counting ? (
            <>
              <span>Page {pageLabel.pageNumber}</span>
              <span className="submissions-pagination__counting">Counting pages...</span>
            </>
          ) : (
            pageLabel.text
          )}
        </p>
        <div className="submissions-pagination__actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (serverMode ? serverPagination.onPrevious() : table.previousPage())}
            disabled={serverMode ? !serverPagination.hasPrevious : !table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (serverMode ? serverPagination.onNext() : table.nextPage())}
            disabled={serverMode ? !serverPagination.hasNext : !table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
