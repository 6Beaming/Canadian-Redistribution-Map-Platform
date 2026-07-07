import * as React from "react";

import { cn } from "@/lib/utils";

function HorizontalTabs({
  items = [],
  value,
  defaultValue,
  onValueChange,
  className,
  listClassName,
  itemClassName,
  ...props
}) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState(
    defaultValue ?? items[0]?.id ?? "",
  );

  React.useEffect(() => {
    if (!isControlled && items.length > 0 && !items.some((item) => item.id === internalValue)) {
      setInternalValue(defaultValue ?? items[0]?.id ?? "");
    }
  }, [defaultValue, internalValue, isControlled, items]);

  const activeValue = isControlled ? value : internalValue;

  function handleSelect(nextValue, disabled) {
    if (disabled || nextValue === activeValue) {
      return;
    }

    if (!isControlled) {
      setInternalValue(nextValue);
    }

    onValueChange?.(nextValue);
  }

  return (
    <div className={cn("w-full overflow-visible", className)} {...props}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        className={cn(
          "tab-menu flex w-full rounded-[30px] border border-[#e8eaed] bg-[#f1f3f4] p-1.5",
          listClassName,
        )}
      >
        {items.map((item) => {
          const isActive = item.id === activeValue;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-state={isActive ? "active" : "inactive"}
              disabled={item.disabled}
              className={cn(
                "tab-item flex min-w-0 flex-1 basis-0 items-center justify-center rounded-[20px] border border-[#d7e6fb] bg-transparent px-5 py-2 text-center text-[14px] leading-5 font-medium text-[#5f6368] outline-none transition-[color,background-color,transform,box-shadow,border-color] duration-[250ms,250ms,200ms,250ms,250ms] ease-[ease,ease,ease,ease,ease] [-webkit-tap-highlight-color:transparent] hover:border-[#c7dafb] hover:text-[#1a73e8] hover:bg-[rgba(26,115,232,0.05)] active:scale-95 data-[state=active]:border-[#1a73e8] data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white data-[state=active]:shadow-[0_4px_12px_rgba(26,115,232,0.25)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#d7e6fb] disabled:hover:bg-transparent disabled:hover:text-[#5f6368]",
                itemClassName,
                item.className,
              )}
              onClick={() => handleSelect(item.id, item.disabled)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { HorizontalTabs };
