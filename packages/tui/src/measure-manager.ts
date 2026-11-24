import type { EvalMeasurement, EvalSummary, EvalsPlanResult } from "@golem/client";
import {
  ANSWER_HINT,
  armRows,
  askLines,
  canUseNumbers,
  doneFooter,
  doneLine,
  measureList,
  memoryWarning,
  paramsView,
  progressView,
  proposalLines,
  resultTables,
  resumePlan,
  runRows,
  runningId,
  startPlan,
  stoppedView,
  type ArmRow,
  type RunRow,
  type MeasureLive,
  type MeasureTone,
} from "@golem/view";

import { rule, wrapText } from "./agents-read.ts";
import type { Press } from "./keys.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";

/**
 * `/agents`, then `m`: Measure. Arms to tick with the memory line, `t` for "I saved my work" (a warning, never a
 * block: a too big arm runs at your own risk), `enter` to start, `a` to read the asks,
 * the earlier measurements below; then one measurement as a run, a stopped run or a result. The page, the command
 * line and this screen share one job in the golem service, so leaving the screen never stops a run. This file only
 * says where the user is and what a key asks for; the data (`evals.plan`, `evals.list`, `evals.get`, `eval.*`) is
 * read by `use-measure.ts`.
 */

export type MeasureListView = {
  selected: number;
  /** Names of the ticked arms. */
  ticked: readonly string[];
  /** "I saved my work" is ticked. */
  saved: boolean;
  notice?: string;
  /** A delete of this id is waiting for `y`. */
  confirm?: string;
  /** The asks of the set are on screen (`a`); `selected` is not moved by them, `scroll` is. */
  asks?: boolean;
  scroll?: number;
};

export type MeasureRunView = {
  id: string;
  /** The table of a finished measurement is on screen instead of the proposal. */
  table?: boolean;
  /** The list of every run is on screen (`a`), with the row `sel` under the cursor and the row `open` showing its details. */
  runs?: boolean;
  sel?: number;
  open?: number;
  scroll?: number;
  notice?: string;
  /** A delete is waiting for `y`. */
  confirm?: boolean;
};

export type MeasureState = { open: boolean; list: MeasureListView; run: MeasureRunView | null };

export const closedMeasure: MeasureState = { open: false, list: { selected: 0, ticked: [], saved: false }, run: null };

export function openMeasure(): MeasureState {
  return { ...closedMeasure, open: true };
}

/** What the screen knows. `plan` and `list` are null until the daemon has answered. */
export type MeasureData = {
  plan: EvalsPlanResult | null;
  list: readonly EvalSummary[] | null;
  /** The measurement of the run view, null until read. */
  measurement: EvalMeasurement | null;
  live: MeasureLive | null;
  /** One plain line when the daemon refused or could not be reached. */
  error: string | null;
  /** A call is on its way. */
  busy: boolean;
};

export type MeasureKey = "up" | "down" | "page-up" | "page-down" | "top" | "bottom" | "enter" | "back" | "space" | "saved" | "refresh" | "stop" | "delete" | "yes" | "table" | "asks" | "open";

export type MeasureAction =
  | { kind: "none" }
  /** Back to the `/agents` list. */
  | { kind: "close" }
  /** Read the plan and the list again (`r`, "check memory again"). */
  | { kind: "refresh" }
  | { kind: "start"; arms: string[]; allowTight: boolean; ownRisk: boolean }
  | { kind: "stop"; id: string }
  | { kind: "resume"; id: string; allowTight: boolean; ownRisk: boolean }
  /** Read this measurement for the run view. */
  | { kind: "open"; id: string }
  | { kind: "apply"; id: string }
  | { kind: "delete"; id: string };

export const WAIT_NOTICE = "Wait a moment, a call is on its way.";
const NOT_READ = "Not read yet. Try again in a moment.";

const LETTER_KEYS: Record<string, MeasureKey | undefined> = {
  " ": "space",
  t: "saved",
  r: "refresh",
  x: "stop",
  d: "delete",
  y: "yes",
  v: "table",
  a: "asks",
  o: "open",
};

export function measureKeyOf(press: Press): MeasureKey | null {
  if (press.name === null && !press.ctrl && !press.meta) return LETTER_KEYS[press.input] ?? null;
  switch (press.name) {
    case "up":
    case "down":
    case "page-up":
    case "page-down":
      return press.name;
    case "home":
      return "top";
    case "end":
      return "bottom";
    case "return":
      return "enter";
    case "escape":
      return "back";
    default:
      return null;
  }
}

const clamp = (index: number, count: number): number => Math.min(Math.max(index, 0), Math.max(0, count - 1));

/** The rows under the cursor of the list: the arms, then the earlier measurements. */
export function measureRows(data: MeasureData, now: Date = new Date()): { arms: ArmRow[]; earlier: ReturnType<typeof measureList> } {
  return { arms: armRows(data.plan?.arms ?? []), earlier: measureList(data.list ?? [], now) };
}

/** True while a measurement runs, from any client. */
export function measureRunning(data: MeasureData): boolean {
  return runningId(data.list ?? []) !== null || (data.plan?.running ?? null) !== null;
}

function withoutNotice(list: MeasureListView): MeasureListView {
  return { selected: list.selected, ticked: list.ticked, saved: list.saved };
}

export function pressMeasure(state: MeasureState, data: MeasureData, key: MeasureKey, now: Date = new Date()): { state: MeasureState; action: MeasureAction } {
  const none = { kind: "none" } as const;
  if (state.run !== null) return pressRun(state, state.run, data, key);
  const list = state.list;
  const confirming = list.confirm;
  const base = withoutNotice(list);
  const at = (next: MeasureListView): MeasureState => ({ ...state, list: next });
  const say = (notice: string): { state: MeasureState; action: MeasureAction } => ({ state: at({ ...base, notice }), action: none });
  if (confirming !== undefined) {
    return key === "yes" ? { state: at(base), action: { kind: "delete", id: confirming } } : { state: at(base), action: none };
  }
  if (list.asks === true) {
    if (key === "back" || key === "asks") return { state: at(base), action: none };
    const step = key === "up" ? -1 : key === "down" ? 1 : key === "page-up" ? -8 : key === "page-down" ? 8 : key === "top" ? -100000 : key === "bottom" ? 100000 : 0;
    return { state: at({ ...base, asks: true, scroll: Math.max(0, (list.scroll ?? 0) + step) }), action: none };
  }
  const { arms, earlier } = measureRows(data, now);
  const count = arms.length + earlier.length;
  const selected = clamp(list.selected, count);
  const row = selected < arms.length ? arms[selected] : undefined;
  const past = selected < arms.length ? undefined : earlier[selected - arms.length];
  const ticked = new Set(list.ticked.filter((name) => arms.some((arm) => arm.name === name)));
  switch (key) {
    case "back":
      return { state: closedMeasure, action: { kind: "close" } };
    case "up":
    case "down":
    case "page-up":
    case "page-down":
    case "top":
    case "bottom": {
      const step = key === "up" ? -1 : key === "down" ? 1 : key === "page-up" ? -5 : key === "page-down" ? 5 : key === "top" ? -count : count;
      return { state: at({ ...base, selected: clamp(selected + step, count) }), action: none };
    }
    case "refresh":
      return { state: at(base), action: { kind: "refresh" } };
    case "space": {
      if (row === undefined) return say("Space ticks an arm. Enter opens a measurement.");
      if (!row.canTick) return say(`${row.title} cannot run: ${row.reason}`); // nothing to run: the model is not installed, or no key
      if (ticked.has(row.name)) ticked.delete(row.name);
      else ticked.add(row.name);
      return { state: at({ ...base, ticked: [...ticked] }), action: none };
    }
    case "saved": {
      if (!arms.some((arm) => ticked.has(arm.name) && arm.needsSaved)) return say("Nothing ticked needs it. Only a tight or risky arm asks you to save your work.");
      return { state: at({ ...base, saved: !list.saved }), action: none };
    }
    case "asks":
      return (data.plan?.asks ?? []).length === 0 ? say("The asks are not read yet.") : { state: at({ ...base, asks: true, scroll: 0 }), action: none };
    case "enter": {
      if (past !== undefined) return { state: { ...state, list: base, run: { id: past.id } }, action: { kind: "open", id: past.id } };
      if (data.busy) return say(WAIT_NOTICE);
      const plan = startPlan(arms, ticked, list.saved, measureRunning(data));
      if (!plan.canStart) return say(plan.line);
      return { state: at({ ...base, ticked: [...ticked] }), action: { kind: "start", arms: plan.arms, allowTight: plan.allowTight, ownRisk: plan.ownRisk } };
    }
    case "delete": {
      if (past === undefined) return say("d deletes an earlier measurement. Move down to one first.");
      if (past.running) return say("It is running. Open it and stop it first.");
      return { state: at({ ...base, confirm: past.id }), action: none };
    }
    default:
      return { state: at(base), action: none };
  }
}

function pressRun(state: MeasureState, run: MeasureRunView, data: MeasureData, key: MeasureKey): { state: MeasureState; action: MeasureAction } {
  const none = { kind: "none" } as const;
  const clean: MeasureRunView = {
    id: run.id,
    ...(run.table === undefined ? {} : { table: run.table }),
    ...(run.scroll === undefined ? {} : { scroll: run.scroll }),
    ...(run.runs === undefined ? {} : { runs: run.runs }),
    ...(run.sel === undefined ? {} : { sel: run.sel }),
    ...(run.open === undefined ? {} : { open: run.open }),
  };
  const at = (next: MeasureRunView): MeasureState => ({ ...state, run: next });
  const say = (notice: string): { state: MeasureState; action: MeasureAction } => ({ state: at({ ...clean, notice }), action: none });
  const found = data.measurement !== null && data.measurement.id === run.id ? data.measurement : null;
  if (run.runs === true) {
    // The list of every run: up/down move, o or enter opens the row, a or Esc goes back to the summary.
    const count = found === null ? 0 : found.runs.length;
    if (key === "back" || key === "asks") {
      const rest: MeasureRunView = { id: run.id, ...(run.table === undefined ? {} : { table: run.table }), ...(run.scroll === undefined ? {} : { scroll: run.scroll }) };
      return { state: at(rest), action: none };
    }
    if (key === "open" || key === "enter") {
      const sel = Math.min(Math.max(run.sel ?? 0, 0), Math.max(0, count - 1));
      return { state: at({ ...clean, open: run.open === sel ? undefined : sel }), action: none };
    }
    const step = key === "up" ? -1 : key === "down" ? 1 : key === "page-up" ? -8 : key === "page-down" ? 8 : key === "top" ? -100000 : key === "bottom" ? 100000 : 0;
    if (step !== 0) return { state: at({ ...clean, sel: Math.min(Math.max((run.sel ?? 0) + step, 0), Math.max(0, count - 1)) }), action: none };
    if (key === "refresh") return { state: at(clean), action: { kind: "open", id: run.id } };
    return { state: at(clean), action: none };
  }
  if (key === "back") return { state: { ...state, run: null }, action: { kind: "refresh" } };
  if (key === "asks") return found === null ? say(NOT_READ) : { state: at({ ...clean, runs: true, sel: 0 }), action: none };
  if (run.confirm === true) {
    return key === "yes" ? { state: at(clean), action: { kind: "delete", id: run.id } } : { state: at(clean), action: none };
  }
  if (key === "up" || key === "down" || key === "page-up" || key === "page-down" || key === "top" || key === "bottom") {
    const step = key === "up" ? -1 : key === "down" ? 1 : key === "page-up" ? -8 : key === "page-down" ? 8 : key === "top" ? -100000 : 100000;
    return { state: at({ ...clean, scroll: Math.max(0, (run.scroll ?? 0) + step) }), action: none };
  }
  if (found === null) return key === "refresh" ? { state: at(clean), action: { kind: "open", id: run.id } } : say(NOT_READ);
  if (key === "saved") {
    // "I saved my work" of the rest of a stopped measurement: it lives in the list state, as for a new one.
    return found.state === "stopped" ? { state: { ...state, run: clean, list: { ...state.list, saved: !state.list.saved } }, action: none } : say("Nothing here needs it.");
  }
  if (data.busy && (key === "enter" || key === "stop" || key === "delete")) return say(WAIT_NOTICE);
  switch (key) {
    case "stop":
      return found.state === "running" ? { state: at(clean), action: { kind: "stop", id: run.id } } : say("It is not running.");
    case "enter": {
      if (found.state === "stopped") {
        const view = stoppedView(found);
        if (view.resume === null) return say("Nothing is left to run.");
        const again = resumePlan(rowsLeft(found, data), state.list.saved);
        if (!again.ready) return say(again.needsSaved && !state.list.saved ? "Press t to tick the box first." : (again.warning ?? "It cannot run now."));
        return { state: at(clean), action: { kind: "resume", id: run.id, allowTight: again.allowTight, ownRisk: again.ownRisk } };
      }
      if (found.state === "done") return canUseNumbers(found) ? { state: at(clean), action: { kind: "apply", id: run.id } } : say(doneFooter(found));
      return say("It is running. x stops it, Esc goes back and it goes on.");
    }
    case "delete":
      return found.state === "running" ? say("It is running. Stop it first (x).") : { state: at({ ...clean, confirm: true }), action: none };
    case "table":
      return found.state === "done" ? { state: at({ ...clean, table: run.table !== true, scroll: 0 }), action: none } : say("The table shows when the measurement is done.");
    case "refresh":
      return { state: at(clean), action: { kind: "open", id: run.id } };
    default:
      return { state: at(clean), action: none };
  }
}

/** The arms the rest of a stopped measurement would play, as the plan sees them now. */
function rowsLeft(found: EvalMeasurement, data: MeasureData): ArmRow[] {
  const left = new Set(found.runs.filter((run) => run.end === "not_run" || run.end === "pending").map((run) => run.arm));
  return armRows((data.plan?.arms ?? []).filter((arm) => left.has(arm.name)));
}

/** The state after a start or a resume answered: the run view of that measurement. */
export function measureOpened(state: MeasureState, id: string): MeasureState {
  return { ...state, run: { id } };
}

/** The state after a delete or a closed run: back at the list. */
export function measureListed(state: MeasureState): MeasureState {
  return { ...state, run: null };
}

/** One plain line, on whichever view is open. */
export function measureNoticed(state: MeasureState, notice: string): MeasureState {
  return state.run !== null ? { ...state, run: { ...state.run, notice } } : { ...state, list: { ...state.list, notice } };
}

// --- the layout

export const LIST_HINT = "↑/↓ move · space tick · t \"I saved my work\" · enter start or open · a the asks · d delete · r check memory · Esc back";
const TONES: Record<MeasureTone, McpTone> = { ok: "ok", act: "wait", bad: "bad", dim: "off", view: "off" };

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function head(trail: string, width: number): McpManagerLine[] {
  const back = "esc back";
  const gap = Math.max(1, width - trail.length - back.length - 1);
  return [{ text: `${trail}${" ".repeat(gap)}${back}`, bold: true }, { text: "─".repeat(Math.max(1, width - 1)), dim: true }];
}

/** `[ ]`, `[x]` and ` - ` for an arm with nothing to run (no model, no key). */
function box(row: ArmRow, ticked: boolean): { text: string; tone: McpTone } {
  if (!row.canTick) return { text: " - ", tone: "off" };
  return ticked ? { text: "[x]", tone: row.needsSaved ? "wait" : "ok" } : { text: "[ ]", tone: "off" };
}

function armLine(row: ArmRow, ticked: boolean, selected: boolean, titleWidth: number, modelWidth: number): McpManagerLine {
  return {
    prefix: selected ? "❯ " : "  ",
    mark: box(row, ticked),
    text: `${row.title.padEnd(titleWidth)}  ${row.model.replace(/^[^/]+\//, "").padEnd(modelWidth)}  ${row.memoryLine}  ${row.tag.text}`,
    selected,
    dim: !row.canTick,
  };
}

function listLines(data: MeasureData, state: MeasureState, width: number, now: Date): McpManagerLine[] {
  const view = state.list;
  const out: McpManagerLine[] = [];
  if (data.error !== null) out.push({ text: data.error, mark: { text: "✘", tone: "bad" } }, { text: "" });
  if (data.plan === null) {
    out.push({ text: data.error === null ? "asking the daemon…" : "The arms could not be read. r tries again.", dim: true });
  } else {
    const { arms, earlier } = measureRows(data, now);
    const selected = clamp(view.selected, arms.length + earlier.length);
    const noRoom = memoryWarning(arms);
    if (noRoom !== null) out.push(...wrapText(noRoom, Math.max(10, width - 2)).map((text, at): McpManagerLine => (at === 0 ? { text, mark: { text: "!", tone: "wait" } } : { text: `  ${text}` })), { text: "" });
    const titleWidth = Math.max(0, ...arms.map((row) => row.title.length));
    const modelWidth = Math.max(0, ...arms.map((row) => row.model.replace(/^[^/]+\//, "").length));
    const ticked = new Set(view.ticked);
    arms.forEach((row, index) => {
      out.push(armLine(row, ticked.has(row.name), index === selected, titleWidth, modelWidth));
      if (index === selected && row.reason.length > 0) {
        for (const part of wrapText(row.reason, Math.max(10, width - 8))) out.push({ text: `      ${part}`, dim: true });
      }
    });
    const plan = startPlan(arms, ticked, view.saved, measureRunning(data));
    if (plan.needsSaved) {
      out.push({ text: "" }, { prefix: "  ", mark: { text: view.saved ? "[x]" : "[ ]", tone: view.saved ? "ok" : "wait" }, text: `t  ${plan.confirm}` });
    }
    out.push({ text: "" }, { text: plan.canStart ? `enter start · ${plan.line}` : plan.line, dim: !plan.canStart });
    if (earlier.length > 0) {
      out.push({ text: "" }, { text: rule("earlier", width), dim: true });
      earlier.forEach((row, index) => {
        const here = arms.length + index === selected;
        const confirming = view.confirm === row.id;
        out.push({
          prefix: here ? "❯ " : "  ",
          mark: { text: row.status.mark, tone: TONES[row.status.tone] },
          text: `${row.status.text.padEnd(7)} ${row.when.padEnd(11)} ${row.arms}${row.note === "" ? "" : ` · ${row.note}`}`,
          selected: here,
        });
        if (confirming) out.push({ text: "      Delete this measurement? y to delete · any other key to cancel", bold: true });
      });
    } else if (data.list !== null) {
      out.push({ text: "" }, { text: "No earlier measurements.", dim: true });
    }
  }
  return out;
}

/** What the open row of the list of runs shows: the message, the set-up, the facts with marks, and the answer kept. */
function detailLines(row: RunRow, width: number): McpManagerLine[] {
  const detail = row.detail;
  if (detail === null) return [{ text: "      The ask is not known for this measurement.", dim: true }];
  const wrap = (text: string, indent: string, max?: number): McpManagerLine[] => {
    const parts = wrapText(text, Math.max(10, width - indent.length - 2));
    const shown = max === undefined ? parts : parts.slice(0, max);
    const cut = max !== undefined && parts.length > max ? [{ text: `${indent}…`, dim: true } as McpManagerLine] : [];
    return [...shown.map((part): McpManagerLine => ({ text: `${indent}${part}` })), ...cut];
  };
  const out: McpManagerLine[] = [...wrap(`The message: "${detail.message}"`, "      ")];
  const note = [detail.setup, detail.why].filter((part) => part !== "").join(" · ");
  if (note !== "") out.push(...wrap(note, "      ").map((line) => ({ ...line, dim: true })));
  out.push({ text: "      The answer must mention:" });
  for (const fact of detail.facts) {
    const mark = fact.mark === "found" ? { text: "✓", tone: "ok" as const } : fact.mark === "missing" ? { text: "✗", tone: "bad" as const } : { text: "–", tone: "off" as const };
    out.push({ text: `  ${fact.text}`, prefix: "      ", mark });
  }
  if (detail.answer === null) out.push({ text: "      No answer was kept for this run.", dim: true });
  else out.push({ text: "      The model's answer:" }, ...wrap(detail.answer, "        ", 12));
  return out;
}

/** Every run, one line each, with the row under the cursor and the open row's details. */
function runsLines(m: EvalMeasurement, run: MeasureRunView, width: number, room: number): McpManagerLine[] {
  const rows = runRows(m);
  const params = paramsView(m);
  const head: McpManagerLine[] = [
    ...params.arms.map((text): McpManagerLine => ({ text, dim: true })),
    ...(params.rules === null ? [] : [{ text: params.rules, dim: true } as McpManagerLine]),
    ...(params.version === null ? [] : [{ text: params.ownRisk ? `${params.version} · started at your own risk` : params.version, dim: true } as McpManagerLine]),
    { text: `answer: ${ANSWER_HINT}`, dim: true },
    { text: "" },
  ];
  const many = new Set(rows.map((row) => row.arm)).size > 1;
  const sel = Math.min(Math.max(run.sel ?? 0, 0), Math.max(0, rows.length - 1));
  const body: McpManagerLine[] = [];
  let at = 0;
  rows.forEach((row, index) => {
    if (index === sel) at = body.length;
    const here = index === sel;
    const numbers = row.word !== "" ? row.word : `${row.answer.padEnd(5)} ${row.time.padStart(5)} ${row.windowLeft.padStart(4)} left`;
    body.push({
      prefix: here ? "❯ " : "  ",
      mark: row.state === "failed" ? { text: "✗", tone: "bad" } : row.state === "done" ? { text: "✓", tone: "ok" } : row.state === "running" ? { text: "●", tone: "wait" } : { text: row.mark, tone: "off" },
      text: `${row.ask.slice(0, 26).padEnd(26)} ${row.helpers.padEnd(3)} ${numbers}${many ? ` · ${row.arm}` : ""}`.trimEnd(),
      selected: here,
    });
    if (run.open === index) body.push(...detailLines(row, width));
  });
  const space = Math.max(1, room - head.length);
  const start = Math.min(Math.max(0, at - Math.floor(space / 2)), Math.max(0, body.length - space));
  return [...head, ...body.slice(start, start + space)];
}

function runLines(data: MeasureData, state: MeasureState, run: MeasureRunView, width: number, room: number): { lines: McpManagerLine[]; hint: string; trail: string } {
  const m = data.measurement !== null && data.measurement.id === run.id ? data.measurement : null;
  const out: McpManagerLine[] = [];
  const summary = (data.list ?? []).find((item) => item.id === run.id);
  const when = summary === undefined ? run.id : measureList([summary])[0]?.when ?? run.id;
  if (data.error !== null) out.push({ text: data.error, mark: { text: "✘", tone: "bad" } }, { text: "" });
  if (m === null) {
    out.push({ text: "reading the measurement…", dim: true });
    return { lines: out, hint: "r read again · Esc back", trail: `Agents › Measure › ${when}` };
  }
  if (run.runs === true) {
    return { lines: runsLines(m, run, width, room), hint: "↑/↓ move · o open the run · a or Esc back", trail: `Agents › Measure › ${when} · runs` };
  }
  const bar = (share: number, cells: number): string => {
    const full = Math.round(Math.min(1, Math.max(0, share)) * cells);
    return "█".repeat(full) + "░".repeat(cells - full);
  };
  if (m.state === "running") {
    const view = progressView(m, data.live);
    out.push({ text: `${bar(view.share, Math.min(20, Math.max(5, width - 30)))}  ${view.time}`.trimEnd(), mark: { text: "●", tone: "wait" } });
    if (view.what !== "") out.push({ text: view.what });
    if (view.memory !== null) out.push({ text: `mem ${view.memory}`, dim: true });
    out.push({ text: "" });
    const rows = runRows(m).filter((r) => r.state === "done" || r.state === "failed" || r.state === "running");
    const last = rows.slice(-Math.max(1, Math.min(5, room - out.length - 3)));
    for (const r of last) {
      out.push({
        mark: r.state === "running" ? { text: "●", tone: "wait" } : r.state === "failed" ? { text: "✗", tone: "bad" } : { text: "✓", tone: "ok" },
        text: `${r.ask.slice(0, 28).padEnd(28)} ${r.helpers.padEnd(3)} ${r.state === "running" || r.word !== "" ? r.word.padEnd(10) : `${r.answer.padEnd(5)} ${r.time.padStart(5)} ${r.windowLeft.padStart(4)} left`}`.trimEnd(),
      });
    }
    return { lines: out, hint: "x stop · a the runs · Esc back to the list (the run goes on)", trail: `Agents › Measure › ${when} · ${view.title.toLowerCase()}` };
  }
  if (m.state === "stopped") {
    const view = stoppedView(m);
    out.push({ text: view.title, mark: { text: "■", tone: "bad" }, bold: true });
    for (const part of wrapText(view.detail, Math.max(10, width - 2))) out.push({ text: part });
    const again = resumePlan(rowsLeft(m, data), state.list.saved);
    if (view.resume !== null && again.warning !== null) {
      out.push({ text: "" }, ...wrapText(again.warning, Math.max(10, width - 2)).map((text, at): McpManagerLine => (at === 0 ? { text, mark: { text: "!", tone: "wait" } } : { text: `  ${text}` })));
    }
    if (view.resume !== null && again.needsSaved) {
      out.push({ text: "" }, { prefix: "  ", mark: { text: state.list.saved ? "[x]" : "[ ]", tone: state.list.saved ? "ok" : "wait" }, text: `t  ${again.confirm}` });
    }
    const keys = [view.resume === null ? null : `enter ${view.resume.toLowerCase()}`, view.resume !== null && again.needsSaved ? "t the box" : null, "a the runs", "d delete", "Esc back"].filter((text): text is string => text !== null);
    return { lines: out, hint: keys.join(" · "), trail: `Agents › Measure › ${when} · stopped` };
  }
  const done = doneLine(m);
  const trail = `Agents › Measure › ${when} · ${done.title.replace(/\.$/, "").toLowerCase()}`;
  if (run.table === true) {
    for (const table of resultTables(m)) {
      out.push({ text: rule(table.title, width), dim: true });
      out.push({ text: `${"ask".padEnd(28)} ${"answer".padEnd(12)} ${"time".padEnd(12)} ${"window left".padEnd(11)} helpers` , dim: true });
      for (const r of table.rows) {
        out.push({
          text: `${r.ask.slice(0, 28).padEnd(28)} ${r.answer.padEnd(12)} ${r.time.padEnd(12)} ${r.windowLeft.padEnd(11)} ${r.helpers.padEnd(3)} ${r.verdict.text.toLowerCase()}`,
          mark: { text: "•", tone: TONES[r.verdict.tone] },
        });
      }
      out.push({ text: "" });
    }
    const start = Math.min(run.scroll ?? 0, Math.max(0, out.length - room));
    return { lines: out.slice(start, start + room), hint: "↑/↓ scroll · v the numbers · d delete · Esc back", trail };
  }
  out.push({ text: done.title, mark: { text: "✓", tone: "ok" }, bold: true });
  for (const part of wrapText(done.detail, Math.max(10, width - 2))) out.push({ text: part });
  out.push({ text: "" });
  for (const line of proposalLines(m)) {
    const value = line.measured && line.proposed !== null ? (line.changed ? `${line.current} → ${line.proposed}` : `${line.current} (unchanged)`) : "not measured";
    out.push({ text: `${line.key.padEnd(12)} ${value.padEnd(18)} ${line.note}`.trimEnd(), mark: { text: line.measured ? (line.changed ? "▲" : "=") : "–", tone: line.measured && line.changed ? "ok" : "off" } });
  }
  out.push({ text: "" }, { text: doneFooter(m), dim: true });
  const keys = [canUseNumbers(m) ? "enter use these numbers" : null, "v the table", "a the runs", "d delete", "Esc back (keeps yours)"].filter((text): text is string => text !== null);
  return { lines: out, hint: keys.join(" · "), trail };
}

export function layoutMeasure(input: { state: MeasureState; data: MeasureData; columns: number; rows: number; now?: Date }): McpManagerLine[] {
  const width = Math.max(1, input.columns);
  const rows = Math.max(0, input.rows);
  const now = input.now ?? new Date();
  const { state, data } = input;
  const run = state.run;
  const notice = run !== null ? run.notice : state.list.notice;
  const extra: McpManagerLine[] = notice === undefined ? [] : [{ text: notice }];
  let trail = "Agents › Measure";
  let hint = LIST_HINT;
  let body: McpManagerLine[];
  const room = Math.max(0, rows - 2 - 2 - extra.length);
  if (run === null && state.list.asks === true) {
    const asks = askLines(data.plan?.asks ?? []);
    const all: McpManagerLine[] = [{ text: "The asks. Each is played twice, with helpers and without.", dim: true }, { text: "" }];
    for (const ask of asks) {
      all.push({ text: ask.name, bold: true });
      for (const part of wrapText(`"${ask.message}"`, Math.max(10, width - 4))) all.push({ text: `  ${part}` });
      const note = [ask.setup, ask.why].filter((text) => text !== "").join(" · ");
      if (note !== "") for (const part of wrapText(note, Math.max(10, width - 4))) all.push({ text: `  ${part}`, dim: true });
      for (const part of wrapText(`The answer must mention: ${ask.mustMention}`, Math.max(10, width - 4))) all.push({ text: `  ${part}`, dim: true });
      all.push({ text: "" });
    }
    const start = Math.min(state.list.scroll ?? 0, Math.max(0, all.length - room));
    body = all.slice(start, start + room);
    trail = "Agents › Measure › asks";
    hint = "↑/↓ scroll · a or Esc back";
  } else if (run === null) {
    body = listLines(data, state, width, now);
    const at = Math.max(0, body.findIndex((line) => line.selected === true));
    const start = Math.min(Math.max(0, at - Math.floor(room / 2)), Math.max(0, body.length - room));
    body = body.length > room ? body.slice(start, start + room) : body;
  } else {
    const shown = runLines(data, state, run, width, room);
    body = shown.lines.slice(0, room);
    trail = shown.trail;
    hint = run.confirm === true ? "Delete this measurement? y to delete · any other key to cancel" : shown.hint;
  }
  const lines: McpManagerLine[] = [...head(trail, width), ...body, ...extra, { text: "" }, { text: hint, dim: true }];
  return lines.slice(0, rows).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}
