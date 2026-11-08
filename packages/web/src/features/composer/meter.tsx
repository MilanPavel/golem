import { formatElapsed, type GolemState } from "@golem/view";
import { useEffect, useState, type ReactNode } from "react";
import { GOLEM_STATE_LABEL } from "../../ui/golem-state.ts";
import { PixelGolem } from "../../ui/pixel-golem.tsx";

/** Whole seconds since an ISO time, never below zero. */
export function elapsedSeconds(since: string | null, now: number): number {
  const start = since === null ? Number.NaN : Date.parse(since);
  return Number.isNaN(start) ? 0 : Math.max(0, Math.floor((now - start) / 1000));
}

/** The clock, ticking once a second only while `active`. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export type MeterProps = {
  state: GolemState;
  /** When the run began (an ISO time), for the elapsed seconds. */
  runStartedAt: string | null;
  /** Something small at the right end of the row, such as the context chip. */
  aside?: ReactNode;
};

/** What the meter says, the same word the sidebar uses. */
export function meterText(state: GolemState, seconds: number): string {
  switch (state) {
    case "idle":
      return GOLEM_STATE_LABEL.idle;
    case "thinking":
      return `working · ${formatElapsed(seconds * 1000)}`;
    case "waiting":
      return "waiting for you";
    default:
      return GOLEM_STATE_LABEL[state];
  }
}

/** The small golem and what golem is doing, above the composer. */
export function Meter({ state, runStartedAt, aside }: MeterProps) {
  const now = useTicker(state === "thinking");
  const text = meterText(state, elapsedSeconds(runStartedAt, now));
  return (
    <div data-meter={state} className="flex min-h-5 items-center gap-2.5 px-1 font-mono text-xs text-muted">
      <PixelGolem state={state} size="sm" />
      {text === "" ? null : <span>{text}</span>}
      {aside === undefined ? null : <span className="ml-auto">{aside}</span>}
    </div>
  );
}
