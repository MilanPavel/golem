import { PLAN_HINT } from "@golem/view";
import { useSession } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { badgeVariants } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";

/** The Plan first switch: a chip beside the mode chip. Clay-soft while on. */
export function PlanChipView({ on, onToggle, disabled = false }: { on: boolean; onToggle: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={PLAN_HINT}
      onClick={() => onToggle(!on)}
      className={cn(
        badgeVariants({ tone: on ? "clay" : "neutral" }),
        "cursor-pointer outline-offset-2 outline-clay focus-visible:outline-2 disabled:cursor-default disabled:opacity-60",
        on ? "hover:brightness-95" : "hover:border-ink hover:text-ink",
      )}
    >
      <span aria-hidden="true">◇</span> Plan first
    </button>
  );
}

const selectOn = ({ chat }: SessionView) => chat.plan.on;

/** Whether a session is in plan first. */
export function usePlanOn(sessionId: string): boolean {
  return useSession(sessionId, selectOn);
}

/** The switch for a session. The change is the dock's, so its failure shows on the dock's error line. */
export function PlanChip({ sessionId, onToggle }: { sessionId: string; onToggle: (on: boolean) => void }) {
  return <PlanChipView on={usePlanOn(sessionId)} onToggle={onToggle} />;
}
