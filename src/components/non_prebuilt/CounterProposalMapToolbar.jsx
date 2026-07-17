import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const viewButtonClassName =
  "h-9 min-w-0 shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold leading-5";

export function CounterProposalMapToolbar({
  isVisible,
  workflow,
  onPreviewModeChange,
  onRedo,
  onUndo,
}) {
  if (!isVisible || !workflow?.cache) {
    return null;
  }

  const previewMode = workflow.previewMode === "original" ? "original" : "proposal";
  const canUndo = (workflow.cache.history?.length ?? 0) > 1;
  const canRedo = (workflow.cache.future?.length ?? 0) > 0;

  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 max-w-[calc(100%-2rem)] -translate-x-1/2">
      <div
        aria-label="Counter-proposal map controls"
        className="pointer-events-auto flex items-center gap-1.5 rounded-[18px] border border-[#d7e6fb] bg-white/95 p-1.5 shadow-[0_10px_30px_rgba(23,50,77,0.18)] backdrop-blur-sm"
        role="toolbar"
      >
        <Button
          aria-label="Undo boundary change"
          className="h-9 w-9 min-w-0 rounded-full p-0"
          disabled={!canUndo}
          size="icon-sm"
          title="Undo"
          type="button"
          variant="outline"
          onClick={onUndo}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          aria-label="Redo boundary change"
          className="h-9 w-9 min-w-0 rounded-full p-0"
          disabled={!canRedo}
          size="icon-sm"
          title="Redo"
          type="button"
          variant="outline"
          onClick={onRedo}
        >
          <Redo2 className="h-4 w-4" />
        </Button>

        <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-[#d7e6fb]" />

        <div
          aria-label="Map preview"
          className="flex items-center gap-1 rounded-full bg-[#f1f3f4] p-1"
          role="group"
        >
          <Button
            aria-pressed={previewMode === "proposal"}
            className={viewButtonClassName}
            type="button"
            variant={previewMode === "proposal" ? "default" : "ghost"}
            onClick={() => onPreviewModeChange?.("proposal")}
          >
            Proposed
          </Button>
          <Button
            aria-pressed={previewMode === "original"}
            className={viewButtonClassName}
            type="button"
            variant={previewMode === "original" ? "default" : "ghost"}
            onClick={() => onPreviewModeChange?.("original")}
          >
            Original
          </Button>
        </div>
      </div>
    </div>
  );
}
