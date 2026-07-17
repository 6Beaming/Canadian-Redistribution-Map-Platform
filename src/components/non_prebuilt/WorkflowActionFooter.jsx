import { cn } from "@/lib/utils";

const workflowActionButtonClassName =
  "box-border inline-flex h-10 w-fit min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] px-4 py-2 text-center text-sm font-medium leading-5";

function WorkflowActionFooter({ children, columns = 2, className }) {
  return (
    <div
      className={cn(
        "mt-2 flex w-full items-center gap-4 border-t border-[#d7e6fb] pt-4",
        columns === 1 ? "justify-end" : "justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}

export { WorkflowActionFooter, workflowActionButtonClassName };
