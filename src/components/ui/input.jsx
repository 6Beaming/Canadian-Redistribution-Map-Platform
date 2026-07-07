import * as React from "react"
import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  ...props
}) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(

        "h-10 w-full min-w-0 rounded-lg border bg-white px-3.5 py-2 text-base md:text-sm outline-none transition-all duration-200",
        
        "border-[#e8f0fe] text-[#3c4043] placeholder:text-[#9aa0a6]",

        "hover:border-[#4285f4]/50",

        "focus:border-[#1a73e8] focus:ring-4 focus:ring-[#1a73e8]/15 focus:shadow-[0_0_12px_rgba(26,115,232,0.1)]",

        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[#3c4043]",

        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[#f8f9fa] disabled:border-[#e8eaed] disabled:text-[#9aa0a6] disabled:opacity-70",

        "aria-invalid:border-[#d93025] aria-invalid:focus:ring-[#d93025]/15 aria-invalid:focus:shadow-[0_0_12px_rgba(217,48,37,0.1)]",

        "dark:bg-[#1f2937]/50 dark:border-[#374151] dark:text-[#f3f4f6] dark:placeholder:text-[#6b7280]",
        "dark:hover:border-[#4285f4]/50",
        "dark:focus:border-[#4285f4] dark:focus:ring-[#4285f4]/20",
        "dark:disabled:bg-[#111827] dark:disabled:border-[#1f2937]",
        "dark:aria-invalid:border-[#ea4335]",
        
        className
      )}
      {...props} />
  );
}

export { Input }