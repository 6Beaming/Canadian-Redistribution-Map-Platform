import * as React from "react";

import { cn } from "@/lib/utils";

const cardSizeClasses = {
  default: "max-w-[360px] gap-6 p-6",
  sm: "max-w-[320px] gap-5 p-5",
};

function Card({ className, size = "default", ...props }) {
  const resolvedSize = cardSizeClasses[size] ? size : "default";

  return (
    <div
      data-slot="card"
      data-size={resolvedSize}
      className={cn(
        "group/card w-full rounded-[16px] border border-[#e8f0fe] bg-white text-left text-[#1a1d20] shadow-[0_4px_20px_rgba(0,0,0,0.02)] transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] hover:-translate-y-1.5 hover:shadow-[0_12px_32px_rgba(26,115,232,0.12)]",
        cardSizeClasses[resolvedSize],
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

function CardAccent({ className, ...props }) {
  return (
    <div
      data-slot="card-accent"
      className={cn("h-1 w-10 rounded-[2px] bg-[#4285f4]", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }) {
  return (
    <div
      data-slot="card-title"
      className={cn("m-0 text-[18px] font-semibold text-[#1a1d20]", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }) {
  return (
    <div
      data-slot="card-description"
      className={cn("m-0 text-[14px] leading-[1.6] text-[#5f6368]", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }) {
  return (
    <div
      data-slot="card-action"
      className={cn("flex items-center justify-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }) {
  return (
    <div
      data-slot="card-content"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center gap-3 pt-2", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  CardAccent,
};
