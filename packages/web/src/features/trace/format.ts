import { contextLevel, contextPercent, contextSummary, formatDuration as formatViewDuration, formatTokens, formatWindow, type ContextLevel } from "@golem/view";
import { modelsOf, type TraceNode, type TraceRunSpan, type TraceSpan } from "../../store/trace.ts";

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

/** Input plus output tokens of the run's model calls, or null when none is recorded. */
export function runTokens(run: TraceRunSpan): number | null {
  let total: number | null = null;
  for (const model of modelsOf(run)) {
    const tokens = spanTokens(model);
    if (tokens !== null) total = (total ?? 0) + tokens;
  }
  return total;
}

/** The context at the end of a run: the input of its last model call that has both input and a window. */
export function endContext(run: TraceRunSpan): { used: number; window: number; estimated: boolean } | null {
  const models = modelsOf(run);
  for (let i = models.length - 1; i >= 0; i--) {
    const model = models[i];
    const used = model?.tokens?.input;
    const window = model?.context_window;
    if (model !== undefined && used !== null && used !== undefined && window !== null && window !== undefined) {
      return { used, window, estimated: model.context_window_estimated === true };
    }
  }
  return null;
}

/** `17%`, rounded down like the header, and `<1%` for a share above 0 and below 0.01. */
function percentText(share: number): string {
  return share > 0 && share < 0.01 ? "<1%" : `${contextPercent(share)}%`;
}

export type TokenCell = { text: string; share: number | null; level: ContextLevel | null; title: string };

/** What the token column of a tree row shows. Null for a tool. */
export function tokenCell(span: TraceNode): TokenCell | null {
  if (span.kind === "tool") return null;
  if (span.kind === "model") {
    const input = span.tokens?.input;
    if (span.recorded === false || input === null || input === undefined) return { text: "—", share: null, level: null, title: "" };
    const window = "context_window" in span ? (span.context_window ?? null) : null;
    const estimated = "context_window_estimated" in span && span.context_window_estimated === true;
    const share = window === null ? null : (window > 0 ? input / window : null);
    const words = [`${formatTokens(input)} in`];
    const output = span.tokens?.output;
    if (output !== null && output !== undefined) words.push(`${formatTokens(output)} out`);
    if (share !== null && window !== null) words.push(`${percentText(share)} of ${estimated ? "≈" : ""}${formatWindow(window)}`);
    return {
      text: share === null ? formatTokens(input) : `${formatTokens(input)} · ${estimated ? "≈" : ""}${percentText(share)}`,
      share,
      level: share === null ? null : contextLevel(input, window),
      title: words.join(" · "),
    };
  }
  const total = runTokens(span);
  if (total === null) return null;
  const end = endContext(span);
  if (end === null) return { text: formatTokens(total), share: null, level: null, title: `${formatTokens(total)} tokens in this run` };
  const share = end.window > 0 ? end.used / end.window : 0;
  const percent = `${end.estimated ? "≈" : ""}${percentText(share)}`;
  return {
    text: `${formatTokens(total)} · ${percent}`,
    share,
    level: contextLevel(end.used, end.window),
    title: `${formatTokens(total)} tokens in this run · context at the end ${formatTokens(end.used)} / ${end.estimated ? "≈" : ""}${formatWindow(end.window)} (${percentText(share)})`,
  };
}

/** Tokens per second the model wrote after its first token, or null when it cannot be told. */
export function throughput(span: TraceSpan): number | null {
  const output = span.tokens?.output;
  const first = span.first_token_ms;
  const total = span.duration_ms;
  if (output === null || output === undefined || output === 0) return null;
  if (first === null || first === undefined || total === null || total === undefined) return null;
  if (total - first < 50) return null;
  return Math.round(output / ((total - first) / 1000));
}

/** `Nov 7, 2026, 11:00:02.120` in the viewer's time zone. `timeZone` is for tests. */
export function localTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
    timeZone,
  }).format(date);
}
