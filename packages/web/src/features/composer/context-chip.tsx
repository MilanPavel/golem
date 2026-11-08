import { contextLevel, contextPercent, contextShare, contextSummary, formatTokens, type ContextLevel } from "@golem/view";
import { useNavigate, useSession } from "../../store/page-context.tsx";
import { tracePath } from "../../store/router.ts";
import { badgeVariants } from "../../ui/badge.tsx";

const TONE: Record<ContextLevel, "neutral" | "wait" | "deny"> = { ok: "neutral", high: "wait", full: "deny" };

/** How full the context is after the latest model call. A button that opens the trace on that call. */
export function ContextChipView({ used, window, onOpen }: { used: number; window: number | null; onOpen: () => void }) {
  const share = contextShare(used, window);
  const text = share === null ? `ctx ${formatTokens(used)}` : `ctx ${contextPercent(share)}%`;
  const summary = contextSummary(used, window, false);
  return (
    <button
      type="button"
      title={`Context ${summary}`}
      aria-label={`Context ${summary}. Open the trace.`}
      onClick={onOpen}
      className={`${badgeVariants({ tone: TONE[contextLevel(used, window)] })} cursor-pointer py-0 outline-offset-2 outline-clay focus-visible:outline-2`}
    >
      {text}
    </button>
  );
}

/** The chip for a session, from its live events. Nothing until a model call has reported its input. */
export function ContextChip({ sessionId }: { sessionId: string }) {
  const last = useSession(sessionId, (view) => view.context.last);
  const navigate = useNavigate();
  if (last === null) return null;
  return <ContextChipView used={last.used} window={last.window} onOpen={() => navigate(tracePath(sessionId, last.spanId))} />;
}
