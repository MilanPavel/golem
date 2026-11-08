import { modelsOf, toolsOf, type TraceNode, type TraceRunSpan } from "../../store/trace.ts";

/** A bar's smallest width, in percent of its run, so a 3 ms tool still shows. */
export const MIN_WIDTH = 0.5;

export type Bar = {
  /** Left edge and width, in percent of the run's time line. */
  left: number;
  width: number;
  /** The wait for an approval in front of a tool, drawn hatched. */
  wait: { left: number; width: number } | null;
};

function at(iso: string): number {
  return Date.parse(iso);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * How long the run's time line is, in ms. A finished run is its own time, and a span that reaches
 * past it is cut at the end. A run still open is as long as its latest span reaches.
 */
export function runExtent(run: TraceRunSpan): number {
  if (run.duration_ms !== null && run.duration_ms !== undefined) return Math.max(run.duration_ms, 1);
  const start = at(run.start);
  let extent = 0;
  for (const model of modelsOf(run)) {
    extent = Math.max(extent, reach(model, start));
    for (const tool of toolsOf(model)) extent = Math.max(extent, reach(tool, start));
  }
  return Math.max(extent, 1);
}

/** Where a span ends, in ms from `origin`. An open span ends where it starts. */
function reach(span: TraceNode, origin: number): number {
  const begin = at(span.start) - origin;
  if (span.end !== null && span.end !== undefined) return at(span.end) - origin;
  return begin + (span.duration_ms ?? 0);
}

/**
 * Where `span` sits on the time line of `run`, as shares of it. A span with no end runs to the
 * end of the run. The run itself is the whole line. A tool that waited for approval has the wait
 * first, and its bar, which is the time it ran, after it.
 */
export function barFor(run: TraceRunSpan, span: TraceNode): Bar {
  if (span.kind === "run") return { left: 0, width: 100, wait: null };
  const extent = runExtent(run);
  const origin = at(run.start);
  const offset = clamp(at(span.start) - origin, 0, extent);
  const waited = span.kind === "tool" ? (span.approval_wait_ms ?? 0) : 0;
  const begin = clamp(offset + waited, 0, extent);
  const stop = span.end ?? null;
  const ran = span.duration_ms ?? (stop === null ? null : Math.max(0, at(stop) - at(span.start) - waited));
  const length = ran ?? Math.max(0, extent - begin);
  const left = (begin / extent) * 100;
  const width = clamp((length / extent) * 100, MIN_WIDTH, Math.max(MIN_WIDTH, 100 - left));
  const wait = waited > 0 ? { left: (offset / extent) * 100, width: ((begin - offset) / extent) * 100 } : null;
  return { left: Math.min(left, 100 - MIN_WIDTH), width, wait };
}
