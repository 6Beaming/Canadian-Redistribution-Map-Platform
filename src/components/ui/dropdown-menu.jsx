import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const triggerClasses =
  "inline-flex min-w-[160px] items-center justify-between gap-3 rounded-[8px] border-0 bg-[#1a73e8] px-6 py-3 text-left text-[15px] font-medium text-white outline-none transition-colors duration-[250ms] ease-linear hover:bg-[#4285f4] focus-visible:ring-2 focus-visible:ring-[#8ab4f8] focus-visible:ring-offset-2 data-[state=open]:bg-[#4285f4] disabled:cursor-not-allowed disabled:bg-[#d2e3fc] disabled:text-[#1967d2] disabled:opacity-70 after:ml-3 after:border-l-[5px] after:border-r-[5px] after:border-t-[5px] after:border-l-transparent after:border-r-transparent after:border-t-white after:content-[''] after:transition-transform after:duration-[250ms] after:ease-linear data-[state=open]:after:rotate-180 disabled:after:border-t-[#1967d2]";

const contentClasses =
  "z-[100] min-w-[200px] overflow-hidden rounded-[12px] border border-[#e8f0fe] bg-white py-1.5 text-[#3c4043] shadow-[0_10px_30px_rgba(26,115,232,0.12)] outline-none transition-[opacity,transform] duration-[250ms] ease-linear data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 data-[state=closed]:-translate-y-2.5 data-[state=open]:opacity-100 data-[state=open]:translate-y-0";

const itemClasses =
  "group/dropdown-menu-item relative flex w-full items-center gap-2 rounded-[11px] px-5 py-2.5 text-[14px] text-[#3c4043] outline-none transition-colors duration-[200ms] ease-linear first:rounded-t-[11px] last:rounded-b-[11px] focus:bg-[#e8f0fe] focus:text-[#1a73e8] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

function DropdownMenu(props) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal(props) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

const DropdownMenuTrigger = React.forwardRef(function DropdownMenuTrigger(
  { className, asChild = false, children, ...props },
  ref,
) {
  if (asChild && React.isValidElement(children)) {
    return (
      <DropdownMenuPrimitive.Trigger ref={ref} asChild data-slot="dropdown-menu-trigger" {...props}>
        {React.cloneElement(children, {
          className: cn(triggerClasses, children.props.className, className),
        })}
      </DropdownMenuPrimitive.Trigger>
    );
  }

  return (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      data-slot="dropdown-menu-trigger"
      className={cn(triggerClasses, className)}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Trigger>
  );
});

const DropdownMenuContent = React.forwardRef(function DropdownMenuContent(
  { className, align = "start", sideOffset = 8, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        data-slot="dropdown-menu-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(contentClasses, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

function DropdownMenuGroup(props) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

const DropdownMenuItem = React.forwardRef(function DropdownMenuItem(
  { className, inset, variant = "default", ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        itemClasses,
        inset && "pl-11",
        variant === "destructive" &&
          "text-[#b3261e] focus:bg-[#fde8e7] focus:text-[#b3261e]",
        className,
      )}
      {...props}
    />
  );
});

const DropdownMenuCheckboxItem = React.forwardRef(function DropdownMenuCheckboxItem(
  { className, children, checked, inset, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      checked={checked}
      className={cn(
        itemClasses,
        "pr-11 data-[state=checked]:text-[#1a73e8]",
        inset && "pl-11",
        className,
      )}
      {...props}
    >
      <span
        data-slot="dropdown-menu-checkbox-item-indicator"
        className="pointer-events-none absolute right-4 flex items-center justify-center text-[#1a73e8]"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});

function DropdownMenuRadioGroup(props) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

const DropdownMenuRadioItem = React.forwardRef(function DropdownMenuRadioItem(
  { className, children, inset, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        itemClasses,
        "pr-11 data-[state=checked]:text-[#1a73e8]",
        inset && "pl-11",
        className,
      )}
      {...props}
    >
      <span
        data-slot="dropdown-menu-radio-item-indicator"
        className="pointer-events-none absolute right-4 flex items-center justify-center text-[#1a73e8]"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
});

const DropdownMenuLabel = React.forwardRef(function DropdownMenuLabel(
  { className, inset, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-5 py-2 text-[11px] font-semibold tracking-[0.08em] text-[#5f6368] uppercase",
        inset && "pl-11",
        className,
      )}
      {...props}
    />
  );
});

const DropdownMenuSeparator = React.forwardRef(function DropdownMenuSeparator(
  { className, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      data-slot="dropdown-menu-separator"
      className={cn("my-1 h-px bg-[#e8f0fe]", className)}
      {...props}
    />
  );
});

function DropdownMenuShortcut({ className, ...props }) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-[11px] tracking-[0.08em] text-[#5f6368] group-focus/dropdown-menu-item:text-[#1a73e8]",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSub(props) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

const DropdownMenuSubTrigger = React.forwardRef(function DropdownMenuSubTrigger(
  { className, inset, children, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(itemClasses, inset && "pl-11", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
});

const DropdownMenuSubContent = React.forwardRef(function DropdownMenuSubContent(
  { className, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      data-slot="dropdown-menu-sub-content"
      className={cn(contentClasses, className)}
      {...props}
    />
  );
});

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
