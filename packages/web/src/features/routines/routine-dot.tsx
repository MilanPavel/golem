import type { RoutineRunLike, RoutineState } from "@golem/view";
import { cn } from "../../ui/cn.ts";

const STATE_MARK: Record<RoutineState, string> = {
  off: "bg-line-strong",
  running: "bg-clay animate-pulse",
  waiting: "bg-wait",
  failed: "bg-deny",
  idle: "border border-line-strong",
};

const STATE_WORD: Record<RoutineState, string> = {
  off: "off",
  running: "running",
  waiting: "needs you",
  failed: "last run failed",
  idle: "scheduled",
};

/** A routine's mark in a list: hollow when it waits for its time, filled when it needs you, failed, or is off. */
export function RoutineDot({ state }: { state: RoutineState }) {
  return (
    <span className="inline-flex w-3.5 shrink-0 justify-center">
      <span aria-hidden="true" className={cn("size-2 rounded-xs", STATE_MARK[state])} />
      <span className="sr-only">{STATE_WORD[state]}</span>
    </span>
  );
}

const RUN_MARK: Record<RoutineRunLike["status"], string> = {
  queued: "border border-line-strong",
  running: "bg-clay animate-pulse",
  waiting: "bg-wait",
  succeeded: "bg-allow",
  failed: "bg-deny",
  skipped: "border border-line-strong",
  cancelled: "bg-line-strong",
};

/** One firing's mark in History. Its word is read aloud, so colour is not the only signal. */
export function RunDot({ status, word }: { status: RoutineRunLike["status"]; word: string }) {
  return (
    <span className="inline-flex w-3.5 shrink-0 justify-center">
      <span aria-hidden="true" className={cn("size-2 rounded-xs", RUN_MARK[status])} />
      <span className="sr-only">{word}</span>
    </span>
  );
}
