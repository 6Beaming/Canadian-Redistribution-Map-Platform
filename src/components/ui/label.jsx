import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const labelVariants = cva(
  "inline-flex items-center justify-center font-medium select-none transition-all duration-200 rounded-md",
  {
    variants: {
      variant: {
        default: "text-sm leading-none text-[#3c4043] peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        red: "text-xs px-2.5 py-1 bg-[#fce8e6] text-[#d93025] border border-[#fad2cf]",
        orange: "text-xs px-2.5 py-1 bg-[#feefe3] text-[#e37400] border border-[#fe3d0c0]/20",
        yellow: "text-xs px-2.5 py-1 bg-[#fef7e0] text-[#b06000] border border-[#fce8b2]",
        green: "text-xs px-2.5 py-1 bg-[#e6f4ea] text-[#137333] border border-[#ceead6]",
        cyan: "text-xs px-2.5 py-1 bg-[#e4f7fb] text-[#007b83] border border-[#cbf0f8]",
        blue: "text-xs px-2.5 py-1 bg-[#e8f0fe] text-[#1a73e8] border border-[#d2e3fc]",
        purple: "text-xs px-2.5 py-1 bg-[#f3e8fd] text-[#a142f4] border border-[#e8d0fc]",
        black: "text-xs px-2.5 py-1 bg-[#202124] text-[#ffffff] border border-[#3c4043]",
        white: "text-xs px-2.5 py-1 bg-[#ffffff] text-[#3c4043] border border-[#e8f0fe] shadow-[0_2px_8px_rgba(26,115,232,0.04)]"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

function Label({
  className,
  variant,
  ...props
}) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(labelVariants({ variant }), className)}
      {...props} />
  );
}

export { Label, labelVariants }