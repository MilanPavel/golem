import { cn } from "./cn.ts";
import { GOLEM_STATE_LABEL, type GolemState } from "./golem-state.ts";

const MARK: Record<GolemState, string> = {
  idle: "border border-line-strong",
  thinking: "bg-clay animate-pulse",
  waiting: "bg-wait",
  failed: "bg-deny",
  offline: "bg-faint",
};

export type StatusDotProps = { state: GolemState; className?: string };

/** A small square mark for a session's state. Its word is read aloud, so colour is not the only signal. */
export function StatusDot({ state, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex", className)}>
      <span aria-hidden="true" className={cn("size-2 rounded-xs", MARK[state])} />
      <span className="sr-only">{GOLEM_STATE_LABEL[state]}</span>
    </span>
  );
}
