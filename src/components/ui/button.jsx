import * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const baseClasses =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[8px] border font-medium text-[16px] leading-none text-white shadow-none outline-none transition-[transform,background-color,box-shadow,color,border-color] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] select-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [-webkit-tap-highlight-color:transparent]";

const variantClasses = {
  default:
    "border-transparent bg-[#1a73e8] text-white hover:bg-[#4285f4] hover:scale-[1.036] hover:shadow-[0_8px_20px_rgba(26,115,232,0.3)] active:bg-[#0d5cb6] active:scale-[0.98] active:shadow-none disabled:bg-[#d2e3fc] disabled:text-[#1967d2] disabled:hover:bg-[#d2e3fc] disabled:hover:scale-100 disabled:hover:shadow-none disabled:active:bg-[#d2e3fc] disabled:active:scale-100",
  outline:
    "border-[#1a73e8] bg-white text-[#1a73e8] hover:bg-[#e8f0fe] hover:text-[#1a73e8] hover:scale-[1.036] hover:shadow-[0_8px_20px_rgba(26,115,232,0.18)] active:bg-[#d2e3fc] active:text-[#0d5cb6] active:scale-[0.98] active:shadow-none disabled:border-[#d2e3fc] disabled:bg-white disabled:text-[#1967d2] disabled:hover:bg-white disabled:hover:scale-100 disabled:hover:shadow-none disabled:active:bg-white disabled:active:scale-100",
  secondary:
    "border-transparent bg-[#e8f0fe] text-[#1967d2] hover:bg-[#d2e3fc] hover:scale-[1.036] hover:shadow-[0_8px_20px_rgba(26,115,232,0.16)] active:bg-[#c2dbff] active:scale-[0.98] active:shadow-none disabled:bg-[#eef3fd] disabled:text-[#6b93d6] disabled:hover:bg-[#eef3fd] disabled:hover:scale-100 disabled:hover:shadow-none disabled:active:bg-[#eef3fd] disabled:active:scale-100",
  ghost:
    "border-transparent bg-transparent text-[#1a73e8] hover:bg-[#e8f0fe] hover:text-[#1a73e8] hover:shadow-none hover:scale-100 active:bg-[#d2e3fc] active:text-[#0d5cb6] active:scale-[0.98] active:shadow-none disabled:bg-transparent disabled:text-[#1967d2] disabled:hover:bg-transparent disabled:hover:scale-100 disabled:hover:shadow-none disabled:active:bg-transparent disabled:active:scale-100",
  destructive:
    "border-transparent bg-[#b3261e] text-white hover:bg-[#d23f31] hover:scale-[1.036] hover:shadow-[0_8px_20px_rgba(179,38,30,0.28)] active:bg-[#8f1d18] active:scale-[0.98] active:shadow-none disabled:bg-[#f4c7c3] disabled:text-[#8f1d18] disabled:hover:bg-[#f4c7c3] disabled:hover:scale-100 disabled:hover:shadow-none disabled:active:bg-[#f4c7c3] disabled:active:scale-100",
  link:
    "border-transparent bg-transparent text-[#1a73e8] hover:bg-transparent hover:text-[#4285f4] hover:scale-100 hover:underline hover:shadow-none active:bg-transparent active:text-[#0d5cb6] active:scale-100 active:shadow-none disabled:bg-transparent disabled:text-[#1967d2] disabled:hover:bg-transparent disabled:hover:scale-100 disabled:hover:shadow-none disabled:active:bg-transparent disabled:active:scale-100",
};

const sizeClasses = {
  default: "min-w-[140px] px-7 py-3",
  xs: "min-w-[96px] px-3 py-2 text-xs",
  sm: "min-w-[120px] px-5 py-2.5 text-sm",
  lg: "min-w-[160px] px-8 py-3.5",
  icon: "size-11 min-w-0 p-0",
  "icon-xs": "size-8 min-w-0 p-0",
  "icon-sm": "size-9 min-w-0 p-0",
  "icon-lg": "size-12 min-w-0 p-0",
};

const compoundClasses = {
  "ghost:default": "min-w-0 px-3 py-2 text-sm",
  "link:default": "min-w-0 px-0 py-0 text-sm underline-offset-4",
  "link:xs": "min-w-0 px-0 py-0 text-xs underline-offset-4",
  "link:sm": "min-w-0 px-0 py-0 text-sm underline-offset-4",
  "link:lg": "min-w-0 px-0 py-0 text-base underline-offset-4",
};

function buttonVariants({
  variant = "default",
  size = "default",
  className,
} = {}) {
  const resolvedVariant = variantClasses[variant] ? variant : "default";
  const resolvedSize = sizeClasses[size] ? size : "default";

  return cn(
    baseClasses,
    variantClasses[resolvedVariant],
    sizeClasses[resolvedSize],
    compoundClasses[`${resolvedVariant}:${resolvedSize}`],
    className,
  );
}

const Button = React.forwardRef(function Button(
  { className, variant = "default", size = "default", asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
});

export { Button, buttonVariants };
