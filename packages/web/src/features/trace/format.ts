import { contextSummary, formatDuration as formatViewDuration, formatTokens } from "@golem/view";
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

export type LatestContext = { spanId: string; used: number; window: number | null; estimated: boolean };

/** The last model call, in order, that reported its input tokens. Null when none did. */
export function latestContext(runs: readonly TraceRunSpan[]): LatestContext | null {
  let latest: LatestContext | null = null;
  for (const run of runs) {
    for (const model of modelsOf(run)) {
      const input = model.tokens?.input;
      if (typeof input === "number") {
        latest = { spanId: model.id, used: input, window: model.context_window ?? null, estimated: model.context_window_estimated === true };
      }
    }
  }
  return latest;
}

/** `context 32.0K / 128K · 25%`, or `context 32.0K` when the window is not known. */
export function contextText(latest: LatestContext): string {
  return `context ${contextSummary(latest.used, latest.window, latest.estimated)}`;
}

/** The input tokens of every model call that reported them, in order. */
export function inputSeries(runs: readonly TraceRunSpan[]): number[] {
  const values: number[] = [];
  for (const run of runs) {
    for (const model of modelsOf(run)) {
      const input = model.tokens?.input;
      if (typeof input === "number") values.push(input);
    }
  }
  return values;
}

/** `2 runs · 2m 30.8s · 110.7K tokens · context 32.0K / 128K · 25%`, with `—` where no tokens were recorded. */
export function summaryLine(runs: readonly TraceRunSpan[]): string {
  const tokens = totalTokens(runs);
  const count = `${runs.length} ${runs.length === 1 ? "run" : "runs"}`;
  const latest = latestContext(runs);
  const base = `${count} · ${formatDuration(totalDuration(runs))} · ${tokens === null ? "—" : formatTokens(tokens)} tokens`;
  return latest === null ? base : `${base} · ${contextText(latest)}`;
}
