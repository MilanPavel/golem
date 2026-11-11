import { DETAILS, type Detail } from "@golem/view";
import { useRef } from "react";
import { cn } from "../../ui/cn.ts";
import { setDetail, useDetail } from "./detail.ts";

const LABELS: Record<Detail, string> = { quiet: "Quiet", normal: "Normal", verbose: "Verbose" };

/** Quiet, Normal, Verbose: how much of each turn's tool steps shows. One radio group; the arrows move between them. */
export function DetailSwitch() {
  const detail = useDetail();
  const group = useRef<HTMLDivElement>(null);
  const move = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = DETAILS[(index + step + DETAILS.length) % DETAILS.length];
    if (next === undefined) return;
    setDetail(next);
    group.current?.querySelectorAll<HTMLElement>("[role=radio]")[DETAILS.indexOf(next)]?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label="Detail" className="inline-flex h-8 items-center rounded-sm border border-line bg-sunken p-0.5 font-ui text-xs">
      {DETAILS.map((level, index) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={detail === level}
          tabIndex={detail === level ? 0 : -1}
          className={cn(
            "cursor-pointer rounded-xs px-2 py-1 font-medium outline-offset-2 outline-clay focus-visible:outline-2",
            detail === level ? "bg-surface text-ink" : "text-muted hover:text-ink",
          )}
          onClick={() => {
            setDetail(level);
          }}
          onKeyDown={(event) => {
            move(event, index);
          }}
        >
          {LABELS[level]}
        </button>
      ))}
    </div>
  );
}
