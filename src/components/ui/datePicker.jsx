"use client"

import * as React from "react"
import { format } from "date-fns"
import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function DatePickerSimple({ date, setDate, className }) {

  return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            id="date-picker-simple"
            className={className ?? "justify-start font-normal"}
          >
            <span className="min-w-0 truncate">
              {date ? format(date, "PPP") : "Pick a date"}
            </span>
            <ChevronDown className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            defaultMonth={date}
          />
        </PopoverContent>
      </Popover>
  )
}
