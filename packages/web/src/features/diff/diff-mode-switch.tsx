import { cn } from "../../ui/cn.ts";
import type { DiffMode } from "./diff-mode.ts";

const MODES: { mode: DiffMode; label: string }[] = [
  { mode: "unified", label: "Unified" },
  { mode: "split", label: "Split" },
];

/** Two toggle buttons: how a diff is laid out. The page keeps the choice; see `useDiffMode`. */
export function DiffModeSwitch({ mode, onChange }: { mode: DiffMode; onChange: (mode: DiffMode) => void }) {
  return (
    <div role="group" aria-label="Diff layout" className="inline-flex rounded-sm border border-line bg-sunken p-0.5 font-ui text-xs">
      {MODES.map((item) => (
        <button
          key={item.mode}
          type="button"
          aria-pressed={mode === item.mode}
          className={cn(
            "rounded-xs px-2 py-0.5 font-medium outline-offset-2 outline-clay focus-visible:outline-2",
            mode === item.mode ? "bg-surface text-ink" : "text-muted hover:text-ink",
          )}
          onClick={() => {
            onChange(item.mode);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
