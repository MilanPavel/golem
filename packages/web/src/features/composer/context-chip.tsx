import { contextLevel, contextPercent, contextShare, contextSummary, formatTokens, type ContextLevel } from "@golem/view";
import { useNavigate, useSession } from "../../store/page-context.tsx";
import { tracePath } from "../../store/router.ts";
import { badgeVariants } from "../../ui/badge.tsx";

const TONE: Record<ContextLevel, "neutral" | "wait" | "deny"> = { ok: "neutral", high: "wait", full: "deny" };

/** How full the context is after the latest model call. A button that opens the trace on that call. */
export function ContextChipView({
  used,
  window,
  windowEstimated = false,
  onOpen,
}: {
  used: number;
  window: number | null;
  windowEstimated?: boolean;
  onOpen: () => void;
}) {
  const share = contextShare(used, window);
  const text = share === null ? `ctx ${formatTokens(used)}` : `ctx ${windowEstimated ? "≈" : ""}${contextPercent(share)}%`;
  const summary = contextSummary(used, window, windowEstimated);
  const why = windowEstimated && share !== null ? " golem read this window from Ollama. It was not sent." : "";
  return (
    <button
      type="button"
      title={`Context ${summary}.${why}`}
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
  return <ContextChipView used={last.used} window={last.window} windowEstimated={last.windowEstimated} onOpen={() => navigate(tracePath(sessionId, last.spanId))} />;
}
