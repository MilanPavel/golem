import { useRef, useState, type ReactNode } from "react";
import { cn } from "../../ui/cn.ts";

/** One step of the page: a small label in the step's tone, then its controls. */
export function Stage({ when, tone, children }: { when?: string; tone?: "wait" | "summary"; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      {when === undefined ? null : (
        <div className={cn("mb-1.5 text-meta font-semibold leading-none", tone === "wait" ? "text-wait" : tone === "summary" ? "text-ctx-summary" : "text-faint")}>
          {when}
        </div>
      )}
      {children}
    </div>
  );
}

export const HEAD = "flex items-center justify-between gap-3";

/**
 * A slider for a share of the room. It saves when it is let go, and only when it moved. It runs from
 * `min` to `max` in steps of five; a share outside that is drawn at the nearest end.
 */
export function ShareSlider({
  share,
  min,
  max,
  label,
  errorId,
  error,
  onSave,
}: {
  share: number;
  min: number;
  max: number;
  label: string;
  errorId: string;
  error: string | undefined;
  onSave: (share: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const moved = useRef<number | null>(null);
  const shown = draft ?? Math.min(max, Math.max(min, Math.round(share * 100)));
  const done = () => {
    const value = moved.current;
    moved.current = null;
    if (value !== null && value / 100 !== share) onSave(value / 100);
    setDraft(null);
  };
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={5}
      value={shown}
      aria-label={label}
      aria-valuetext={`${shown}% full`}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={error === undefined ? undefined : errorId}
      onChange={(event) => {
        moved.current = Number(event.currentTarget.value);
        setDraft(moved.current);
      }}
      onPointerUp={done}
      onKeyUp={done}
      onBlur={done}
      className="mt-2 w-full accent-clay"
    />
  );
}
