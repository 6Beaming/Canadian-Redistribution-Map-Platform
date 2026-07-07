/* source from https://ui.shadcn.com/docs/components/radix/data-table#basic-table */


import * as React from "react"

import {
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table"

import { Button } from "@/components//ui/button"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { DatePickerSimple } from "@/components/ui/datePicker"
import { subDays } from "date-fns"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

export default function SubmissionsTable({ columns, data, onRowClick }) {

    const [sorting, setSorting] = React.useState([])
    const [columnFilters, setColumnFilters] = React.useState([])

    const table = useReactTable({
        data,
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
    })


    const [dateStart, setDateStart] = React.useState(subDays(new Date(), 30))

    const [dateEnd, setDateEnd] = React.useState(new Date())

    const [visibleSubmissions, setVisibleSubmissions] = React.useState({
        comments: true,
        objections: true,
        counterproposal: true,
    });



    return (
        <div>
            <div className="flex items-center py-4">
                <Input
                    placeholder="Filter ridings..."
                    value={(table.getColumn("riding")?.getFilterValue()) ?? ""}
                    onChange={(event) =>
                        table.getColumn("riding")?.setFilterValue(event.target.value)
                    }
                    className="max-w-sm"
                />
                <DatePickerSimple date = {dateStart} setDate={setDateStart}/>
                <DatePickerSimple date = {dateEnd} setDate={setDateEnd}/>
                <DropdownMenu>
                    <DropdownMenuTrigger className="ml-auto">
                        Submission Type
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">

                        <DropdownMenuCheckboxItem
                            key="comments"
                            className="capitalize"
                            checked={visibleSubmissions.comments}
                            onCheckedChange={(value) =>
                                setVisibleSubmissions((prev) => ({
                                    comments: value,
                                    objections: prev.objections,
                                    counterproposal: prev.counterproposal,
                                }))
                            }
                        >
                            Comments
                        </DropdownMenuCheckboxItem>

                        <DropdownMenuCheckboxItem
                            key="objections"
                            className="capitalize"
                            checked={visibleSubmissions.objections}
                            onCheckedChange={(value) =>
                                setVisibleSubmissions((prev) => ({
                                    comments: prev.comments,
                                    objections: value,
                                    counterproposal: prev.counterproposal,
                                }))
                            }
                        >
                            Objections
                        </DropdownMenuCheckboxItem>

                        <DropdownMenuCheckboxItem
                            key="counterproposal"
                            className="capitalize"
                            checked={visibleSubmissions.counterproposal}
                            onCheckedChange={(value) =>
                                setVisibleSubmissions((prev) => ({
                                    comments: prev.comments,
                                    objections: prev.objections,
                                    counterproposal: value,
                                }))
                            }
                        >
                            Counterproposal
                        </DropdownMenuCheckboxItem>

                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="overflow-hidden rounded-md border">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    className={onRowClick ? "cursor-pointer" : undefined}
                                    onClick={
                                        onRowClick
                                            ? () => onRowClick(row.original)
                                            : undefined
                                    }
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
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
            <div className="flex items-center justify-end space-x-2 py-4">
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
    )
}
