import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { flushSync } from "react-dom";

import {

  flexRender,

  getCoreRowModel,

  getSortedRowModel,

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

import { ArrowUpDown } from "lucide-react";

import { useNavigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext.jsx";

import { getMySubmissionTableRows } from "@/services/submissionListsApi";

import { PanelLoadingOverlay } from "@/components/non_prebuilt/LoadingIndicator.jsx";

import { normalizePublicSubmissionStatus } from "@/lib/submissions/publicStatus.js";

import { SubmissionListPrefetchController } from "@/lib/submissions/submissionListPrefetch.js";

import {

  buildSubmissionListPageLabel,

  needsApiFetchForUiPage,

  SUBMISSION_LIST_UI_PAGE_SIZE,

} from "@/lib/submissions/submissionListPaging.js";



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



function toTableSubmission(submission) {

  return {

    id: submission.id,

    submittedAt: submission.created_at,

    type: formatSubmissionType(submission.type),

    title: submission.title,

    community_name: submission.dissemination_areas?.community_name ?? "Unknown",

    status: normalizePublicSubmissionStatus(submission.status),

  };

}



function computePageStats(items, cache, uiPageIndex) {

  const filteredCount = items.length;

  const nextOffset = (uiPageIndex + 1) * SUBMISSION_LIST_UI_PAGE_SIZE;

  const hasNext = nextOffset < filteredCount || cache.hasMore;

  const totalPages = cache.fullyLoaded

    ? Math.max(1, Math.ceil(filteredCount / SUBMISSION_LIST_UI_PAGE_SIZE))

    : null;



  return { hasNext, totalPages };

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

  const [visibleRows, setVisibleRows] = useState([]);

  const [loadError, setLoadError] = useState("");

  const [tableFetching, setTableFetching] = useState(true);

  const [uiPageIndex, setUiPageIndex] = useState(0);

  const [hasNextUiPage, setHasNextUiPage] = useState(false);

  const [totalPages, setTotalPages] = useState(null);

  const [paginationSuffix, setPaginationSuffix] = useState("counting");

  const { sessionStatus, user } = useAuth();

  const prefetchRef = useRef(null);

  const uiPageIndexRef = useRef(0);



  uiPageIndexRef.current = uiPageIndex;



  useEffect(() => {

    if (sessionStatus === "signed-out") {

      navigate("/sign-in", { replace: true });

    }

  }, [navigate, sessionStatus]);



  const applyCacheToView = useCallback(({

    targetUiPageIndex = uiPageIndexRef.current,

    endFetching = false,

  } = {}) => {

    const cache = prefetchRef.current?.cache;

    if (!cache) return;



    const items = cache.items;

    const start = targetUiPageIndex * SUBMISSION_LIST_UI_PAGE_SIZE;

    const pageRows = items.slice(start, start + SUBMISSION_LIST_UI_PAGE_SIZE).map(toTableSubmission);

    const stats = computePageStats(items, cache, targetUiPageIndex);



    flushSync(() => {

      setUiPageIndex(targetUiPageIndex);

      setHasNextUiPage(stats.hasNext);

      setTotalPages(stats.totalPages);

      setPaginationSuffix(cache.fullyLoaded ? "total" : "counting");

      setVisibleRows(pageRows);

      if (endFetching) {

        setTableFetching(false);

      }

    });

  }, []);



  const runWithTableFetching = useCallback(async (task) => {

    setTableFetching(true);

    try {

      await task();

    } catch (error) {

      setTableFetching(false);

      throw error;

    }

  }, []);



  const navigateUiPage = useCallback(async (targetUiPageIndex) => {

    const controller = prefetchRef.current;

    if (!controller) return;



    const needsFetch = needsApiFetchForUiPage(controller.cache, targetUiPageIndex);



    if (needsFetch) {

      await runWithTableFetching(async () => {

        await controller.fetchNextBatchUrgent();

        applyCacheToView({ targetUiPageIndex, endFetching: true });

      });

      return;

    }



    applyCacheToView({ targetUiPageIndex });

  }, [applyCacheToView, runWithTableFetching]);



  const applyCacheToViewRef = useRef(applyCacheToView);

  applyCacheToViewRef.current = applyCacheToView;



  useEffect(() => {

    if (sessionStatus !== "signed-in" || !user?.id) {

      return undefined;

    }



    let alive = true;

    const controller = new SubmissionListPrefetchController({

      fetchPage: getMySubmissionTableRows,

      buildFiltersKey: () => "mine",

      onUpdate: () => {

        if (!alive || prefetchRef.current !== controller) return;

        applyCacheToViewRef.current();

      },

    });

    prefetchRef.current = controller;



    void (async () => {

      setTableFetching(true);

      setLoadError("");

      try {

        await controller.bootstrap({});

        if (!alive || prefetchRef.current !== controller) return;

        applyCacheToViewRef.current({ endFetching: true });

      } catch (err) {

        if (!alive) return;

        console.error(err);

        setLoadError(err.message || "Unable to load your submissions.");

        setTableFetching(false);

      }

    })();



    return () => {

      alive = false;

      controller.dispose();

      if (prefetchRef.current === controller) {

        prefetchRef.current = null;

      }

    };

  }, [sessionStatus, user?.id]);



  const table = useReactTable({

    data: visibleRows,

    columns,

    getCoreRowModel: getCoreRowModel(),

    getSortedRowModel: getSortedRowModel(),

    manualPagination: true,

    onSortingChange: setSorting,

    state: { sorting },

    pageCount: uiPageIndex + (hasNextUiPage ? 2 : 1),

  });



  const pageLabel = buildSubmissionListPageLabel({

    pageIndex: uiPageIndex,

    totalPages,

    paginationSuffix,

  });



  if (sessionStatus !== "signed-in") {

    return null;

  }



  return (

    <div className="px-[clamp(0.5rem,2vw,1.5rem)] py-[clamp(1rem,3vw,1.5rem)]">

      <div className="submissions-page__content flex flex-col gap-4">

        {loadError ? (

          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">

            {loadError}

          </p>

        ) : null}

        <div className="submissions-table-shell relative rounded-lg border border-gray-200 shadow-sm">

          {tableFetching ? <PanelLoadingOverlay label="Loading..." /> : null}

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

                        className="h-14 cursor-pointer transition-colors hover:bg-gray-50 focus-visible:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500"

                        role="link"

                        tabIndex={0}

                        aria-label={`Open submission ${row.original.id}: ${row.original.title}`}

                        onClick={() => navigate(`/submissions/${encodeURIComponent(row.original.id)}`)}

                        onKeyDown={(event) => {

                          if (event.key === "Enter" || event.key === " ") {

                            event.preventDefault();

                            navigate(`/submissions/${encodeURIComponent(row.original.id)}`);

                          }

                        }}

                        onMouseEnter={() => setHoveredRowId(row.id)}

                        onMouseLeave={() => setHoveredRowId((current) => (current === row.id ? null : current))}

                        onFocus={() => setHoveredRowId(row.id)}

                        onBlur={() => setHoveredRowId((current) => (current === row.id ? null : current))}

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

              ) : tableFetching ? (

                <TableRow aria-hidden="true">

                  <TableCell colSpan={columns.length} className="h-24" />

                </TableRow>

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

          <p className="submissions-pagination__label text-sm text-gray-500">

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

              onClick={() => {

                void navigateUiPage(Math.max(uiPageIndex - 1, 0));

              }}

              disabled={uiPageIndex === 0 || tableFetching}

            >

              Previous

            </Button>

            <Button

              variant="outline"

              size="sm"

              onClick={() => {

                if (!hasNextUiPage) return;

                void navigateUiPage(uiPageIndex + 1);

              }}

              disabled={!hasNextUiPage || tableFetching}

            >

              Next

            </Button>

          </div>

        </div>

      </div>

    </div>

  );

}


