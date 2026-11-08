import { formatDuration as formatViewDuration, formatTokens } from "@golem/view";
import { modelsOf, type TraceNode, type TraceRunSpan } from "../../store/trace.ts";

/** `—` for an unknown time, else minutes and seconds: `0m 00.048s` under a second, `0m 18.4s`, `2m 30.8s`. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return formatViewDuration(ms);
}

/** Input and output tokens of one span, or null when the provider reported neither. */
export function spanTokens(span: TraceNode): number | null {
  const tokens = span.tokens;
  if (tokens === null || tokens === undefined) return null;
  if (tokens.input === null && tokens.output === null) return null;
  return (tokens.input ?? 0) + (tokens.output ?? 0);
}

/** Input plus output tokens of every model call, or null when none is recorded. */
export function totalTokens(runs: readonly TraceRunSpan[]): number | null {
  let total: number | null = null;
  for (const run of runs) {
    for (const model of modelsOf(run)) {
      const tokens = spanTokens(model);
      if (tokens !== null) total = (total ?? 0) + tokens;
    }
  }
  return total;
}

/** The sum of the runs' own times. A run that is still open adds nothing. */
export function totalDuration(runs: readonly TraceRunSpan[]): number {
  return runs.reduce((sum, run) => sum + (run.duration_ms ?? 0), 0);
}

/** `2 runs · 0m 24.6s · 52.0K tokens`, with `—` where no tokens were recorded. */
export function summaryLine(runs: readonly TraceRunSpan[]): string {
  const tokens = totalTokens(runs);
  const count = `${runs.length} ${runs.length === 1 ? "run" : "runs"}`;
  return `${count} · ${formatDuration(totalDuration(runs))} · ${tokens === null ? "—" : formatTokens(tokens)} tokens`;
}
