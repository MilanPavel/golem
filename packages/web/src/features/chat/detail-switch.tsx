import { DETAILS, type Detail } from "@golem/view";
import { useId, useRef } from "react";
import { setDetail, useDetail } from "./detail.ts";

const LABELS: Record<Detail, string> = { quiet: "Quiet", normal: "Normal", verbose: "Verbose" };

/** The Chat detail setting in Settings → Appearance: Quiet, Normal, Verbose: how much of each turn's tool steps shows. One radio group; the arrows move between them. */
export function DetailSwitch() {
  const detail = useDetail();
  const hintId = useId();
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
    <div>
      <div ref={group} role="radiogroup" aria-label="Chat detail" aria-describedby={hintId} className="flex items-center gap-2">
        <span className="text-sm text-muted">Chat detail</span>
        {DETAILS.map((level, index) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={detail === level}
            tabIndex={detail === level ? 0 : -1}
            className="cursor-pointer rounded-md border border-line-strong bg-surface px-3 py-1 text-sm outline-offset-2 outline-clay focus-visible:outline-2 aria-checked:bg-clay-soft aria-checked:text-clay-ink"
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
      <p id={hintId} className="mt-1 text-sm text-muted">
        How much of each step the chat shows. Quiet: a step count. Normal: a summary. Verbose: every step open.
      </p>
    </div>
  );
}
