import type { TraceRunSpan } from "../../store/trace.ts";
import { ContextBar } from "./context-bar.tsx";
import { inputSeries, latestContext, summaryLine } from "./format.ts";
import { Sparkline } from "./sparkline.tsx";

/** The session's totals, how full the context is now, and how the input grew. */
export function TraceSummary({ runs, stacked = false }: { runs: readonly TraceRunSpan[]; stacked?: boolean }) {
  const latest = latestContext(runs);
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-x-3 gap-y-1.5 ${stacked ? "flex-wrap" : ""}`}>
      <p className={`min-w-0 font-mono text-xs text-muted ${stacked ? "basis-full" : "truncate"}`}>{summaryLine(runs)}</p>
      {latest ? <ContextBar used={latest.used} window={latest.window} /> : null}
      <Sparkline values={inputSeries(runs)} />
    </div>
  );
}
