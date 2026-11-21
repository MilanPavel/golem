import { Button } from "../../ui/button.tsx";

/** "1 of 2" with previous and next buttons, over the question the dock shows now. */
export function DockCounter({ index, total, onPick }: { index: number; total: number; onPick: (index: number) => void }) {
  if (total < 2) return null;
  return (
    <div role="group" aria-label="Questions waiting" data-dock-counter="" className="flex items-center gap-1 px-1 pb-1 text-xs text-muted">
      <Button
        size="sm"
        kind="ghost"
        aria-label="Previous question"
        disabled={index <= 0}
        onClick={() => {
          onPick(index - 1);
        }}
      >
        <span aria-hidden="true">‹</span>
      </Button>
      <span aria-live="polite">
        {index + 1} of {total}
      </span>
      <Button
        size="sm"
        kind="ghost"
        aria-label="Next question"
        disabled={index >= total - 1}
        onClick={() => {
          onPick(index + 1);
        }}
      >
        <span aria-hidden="true">›</span>
      </Button>
    </div>
  );
}
