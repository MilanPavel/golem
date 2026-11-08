import type { TraceRunSpan } from "../../store/trace.ts";
import { ContextBar } from "./context-bar.tsx";
import { inputSeries, latestContext, summaryLine } from "./format.ts";
import { Sparkline } from "./sparkline.tsx";

/** The session's totals, how full the context is now, and how the input grew. */
export function TraceSummary({ runs }: { runs: readonly TraceRunSpan[] }) {
  const latest = latestContext(runs);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <p className="min-w-0 truncate font-mono text-xs text-muted">{summaryLine(runs)}</p>
      {latest ? <ContextBar used={latest.used} window={latest.window} /> : null}
      <Sparkline values={inputSeries(runs)} />
    </div>
  );
}
