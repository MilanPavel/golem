import type { ChatEvent } from "@golem/client";

import { formatElapsed } from "./duration.ts";
import { foldBatch, helperRight, type CardTone, type HelperBatch, type IsLocal } from "./helper-card.ts";
import type { WaitLength } from "./wait.ts";

/**
 * The steps list (ticket 15.7.2, "How it ran"): one row per step with a time bar on a scale shared
 * by the whole list. Pure: the Inspector's Steps tab, Runs in the rail and the terminal draw it.
 *
 * The list is generic (`StepSpan` in, `StepsList` out) so workflow runs (3.9, #741) can feed it
 * their own steps. `helperSteps` is the adapter for a batch of helpers (ADR-059).
 */

/** What a bar segment means: the step works, waits in line (slot, provider, load, team), or waits for you. */
export type BarKind = "work" | "line" | "you";

/** A change of phase at a time in ms: from this time on the step is in `kind`. */
export type PhaseMark = { atMs: number; kind: BarKind };

/** A step as the list takes it. `endMs` is null while it runs; it then ends at "now". */
export type StepSpan = {
  id: string;
  label: string;
  /** `lead` for the lead's own step, `helper` for a helper. */
  role: "lead" | "helper";
  startMs: number;
  endMs: number | null;
  /** Phase changes in time order. A step with none works from start to end. */
  marks: PhaseMark[];
  /** The state or wait reason, as text. */
  right: string;
  tone: CardTone;
  /** Overrides the taken time when the source knows it (`duration_ms`). */
  tookMs?: number | null;
};

/** A stretch of a bar on the shared 0..1 scale. */
export type BarSegment = { kind: BarKind; from: number; to: number };

export type StepRow = {
  id: string;
  label: string;
  role: "lead" | "helper";
  right: string;
  tone: CardTone;
  /** True while the step has no end and runs to "now". */
  running: boolean;
  /** Start and length on the shared scale, 0..1. */
  from: number;
  to: number;
  startMs: number;
  endMs: number;
  /** Time taken in ms, and as text (`8s`, `1m 03s`). */
  tookMs: number;
  took: string;
  /** Segments in order, merged, none empty. They lie within `from`..`to`. */
  segments: BarSegment[];
};

export type StepsList = {
  /** Rows in start order; at equal starts the lead first, then the order they came in. */
  rows: StepRow[];
  /** The scale: the earliest start and the latest end (or "now"), in ms. */
  originMs: number;
  endMs: number;
  /** `endMs - originMs`, at least 1. */
  spanMs: number;
};

/** The segments of one span between its start and `end`, merged where neighbours share a kind. */
function segmentsOf(span: StepSpan, end: number, origin: number, scale: number): BarSegment[] {
  const marks = [...span.marks].filter((mark) => mark.atMs < end).sort((a, b) => a.atMs - b.atMs);
  const out: BarSegment[] = [];
  let kind: BarKind = "work";
  let at = span.startMs;
  const push = (to: number): void => {
    if (to <= at) return;
    const last = out[out.length - 1];
    const from = (at - origin) / scale;
    const upto = (to - origin) / scale;
    if (last !== undefined && last.kind === kind) last.to = upto;
    else out.push({ kind, from, to: upto });
    at = to;
  };
  for (const mark of marks) {
    push(Math.max(mark.atMs, at));
    kind = mark.kind;
  }
  push(end);
  return out;
}

/**
 * The list for spans. A running span ends at `nowMs`, passed in: nothing here reads a clock. The
 * scale covers every row, from the earliest start to the latest end or `nowMs` while one runs.
 */
export function layoutSteps(spans: readonly StepSpan[], nowMs: number): StepsList {
  const ordered = spans
    .map((span, order) => ({ span, order }))
    .sort((a, b) => a.span.startMs - b.span.startMs || (a.span.role === b.span.role ? 0 : a.span.role === "lead" ? -1 : 1) || a.order - b.order)
    .map((entry) => entry.span);
  if (ordered.length === 0) return { rows: [], originMs: nowMs, endMs: nowMs, spanMs: 1 };
  const ends = ordered.map((span) => Math.max(span.startMs, span.endMs ?? nowMs));
  const originMs = Math.min(...ordered.map((span) => span.startMs));
  const endMs = Math.max(...ends);
  const spanMs = Math.max(1, endMs - originMs);
  const rows = ordered.map((span, i): StepRow => {
    const end = ends[i] ?? span.startMs;
    const tookMs = span.tookMs ?? end - span.startMs;
    return {
      id: span.id,
      label: span.label,
      role: span.role,
      right: span.right,
      tone: span.tone,
      running: span.endMs === null,
      from: (span.startMs - originMs) / spanMs,
      to: (end - originMs) / spanMs,
      startMs: span.startMs,
      endMs: end,
      tookMs,
      took: formatElapsed(tookMs),
      segments: segmentsOf(span, end, originMs, spanMs),
    };
  });
  return { rows, originMs, endMs, spanMs };
}

/** What a helper wait reason means for the bar: `you` is the person, everything else is a line. */
function kindOfState(state: string, reason: string | null): BarKind {
  if (state === "running") return "work";
  return reason === "you" ? "you" : "line";
}

/**
 * The timing of one helper: start, end and phase changes, with the phase it is in now. `fresh` is true
 * until its first state or step, since a step of a helper that only started means it runs, as the batch card has it.
 */
export type HelperTimes = { startMs: number; endMs: number | null; tookMs: number | null; marks: PhaseMark[]; kind: BarKind; fresh: boolean };

/** The timing of the helpers of one `delegate` call, by helper index. */
export type BatchTimes = Readonly<Record<number, HelperTimes>>;

function parseTs(ts: string): number | null {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The timing after one `helper.*` event of one call (the caller picks the call). Other events change
 * nothing. The reducer path keeps this beside the batch, since the batch itself holds no times.
 */
export function reduceTimes(times: BatchTimes, event: ChatEvent): BatchTimes {
  if (event.type !== "helper.started" && event.type !== "helper.state" && event.type !== "helper.step" && event.type !== "helper.ended") return times;
  const at = parseTs(event.ts);
  if (at === null) return times;
  const index = event.data.index;
  const line = times[index];
  if (event.type === "helper.started") {
    if (line !== undefined) return times;
    // A helper starts in line until a state or a step says it runs, as the batch card has it.
    return { ...times, [index]: { startMs: at, endMs: null, tookMs: null, marks: [{ atMs: at, kind: "line" }], kind: "line", fresh: true } };
  }
  // An event before `helper.started` (a lost event) opens the row at that time.
  const base: HelperTimes = line ?? { startMs: at, endMs: null, tookMs: null, marks: [], kind: "work", fresh: false };
  if (event.type === "helper.ended") return { ...times, [index]: { ...base, endMs: at, tookMs: event.data.duration_ms } };
  if (base.endMs !== null) return times;
  const wasFresh = base.fresh && event.type === "helper.step";
  const next: BarKind | null = event.type === "helper.state" ? kindOfState(event.data.state, event.data.reason ?? null) : wasFresh ? "work" : null;
  if (next === null || next === base.kind) return { ...times, [index]: { ...base, fresh: false } };
  return { ...times, [index]: { ...base, fresh: false, kind: next, marks: [...base.marks, { atMs: at, kind: next }] } };
}

/** The timing of each helper of one `delegate` call, from the lead's events. */
function timelines(callId: string, events: readonly ChatEvent[]): BatchTimes {
  let times: BatchTimes = {};
  for (const event of events) {
    if ((event.type === "helper.started" || event.type === "helper.state" || event.type === "helper.step" || event.type === "helper.ended") && event.data.call_id === callId) {
      times = reduceTimes(times, event);
    }
  }
  return times;
}

export type HelperStepsOptions = {
  /** Say what a model is (local or cloud), as `foldBatch` takes it. */
  isLocal?: IsLocal;
  length?: WaitLength;
  /**
   * Give the lead's own step a row. It starts at `startedAt` (an ISO time, when the lead called
   * `delegate`) or at the first helper, and ends when the batch ends. Its bar is all `work`.
   */
  lead?: { label: string; startedAt?: string };
};

function leadSpan(batch: HelperBatch, rows: readonly StepSpan[], lead: NonNullable<HelperStepsOptions["lead"]>): StepSpan {
  const asked = lead.startedAt === undefined ? null : parseTs(lead.startedAt);
  const startMs = asked ?? Math.min(...rows.map((row) => row.startMs));
  const open = rows.some((row) => row.endMs === null) || batch.helpers.length === 0;
  const endMs = open ? null : Math.max(startMs, ...rows.map((row) => row.endMs ?? startMs));
  return {
    id: `lead:${batch.callId}`,
    label: lead.label,
    role: "lead",
    startMs,
    endMs,
    marks: [],
    right: open ? (batch.parked ? "waiting for helpers" : "running") : "done",
    tone: open ? "run" : "ok",
  };
}

/**
 * The steps list of one `delegate` call: from the lead's events, the optional lead row and one row
 * per helper, with the bars on one scale. `nowMs` ends every row that still runs.
 *
 * - Local models only: helpers take turns on one model, so later rows start in line (`line`
 *   segments) and their `work` follows the earlier row's.
 * - Cloud models only: helpers overlap, their bars start together and have no `line` segment.
 */
export function helperSteps(callId: string, events: readonly ChatEvent[], nowMs: number, options: HelperStepsOptions = {}): StepsList {
  return batchSteps(foldBatch(callId, events, options.isLocal), timelines(callId, events), nowMs, options);
}

/** The same list from a reduced batch and its timing (`ChatState.batches` and `ChatState.batchTimes`). */
export function batchSteps(batch: HelperBatch, times: BatchTimes, nowMs: number, options: HelperStepsOptions = {}): StepsList {
  const callId = batch.callId;
  const spans: StepSpan[] = [];
  for (const helper of batch.helpers) {
    const line = times[helper.index];
    if (line === undefined) continue;
    spans.push({
      id: `${callId}:${String(helper.index)}`,
      label: helper.label !== "" ? helper.label : helper.agent !== "" ? helper.agent : `helper ${String(helper.index + 1)}`,
      role: "helper",
      startMs: line.startMs,
      endMs: line.endMs,
      marks: line.marks,
      right: helperRight(helper, options.length),
      tone: helper.state === "running" ? "run" : helper.state === "done" ? "ok" : helper.state === "failed" ? "bad" : "wait",
      tookMs: line.tookMs,
    });
  }
  const all = options.lead !== undefined && spans.length > 0 ? [leadSpan(batch, spans, options.lead), ...spans] : spans;
  return layoutSteps(all, nowMs);
}
