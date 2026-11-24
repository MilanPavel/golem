import type { EvalMeasurement, EvalNumber, EvalPlanArm, EvalProgress, EvalRun, EvalSummary, EvalUpdate } from "@golem/client";

/**
 * Settings › Agents › Measure (ADR for #1710): what the page says about a measurement of the helper rules.
 * Pure, so no screen adds a word. On screen it is a "measurement", never an "eval".
 */

// --- the arms of a new measurement

export type Tone = "ok" | "act" | "bad" | "dim" | "view";

/** The bar of a local arm, as shares (0 to 1) of the machine's memory: what others hold, then what the model needs. */
export type MemoryBar = { other: number; need: number; tone: "ok" | "bad" };

export type ArmRow = {
  name: string;
  title: string;
  /** The model it would use, and the others it could use. */
  model: string;
  choices: readonly { ref: string; label: string }[];
  /** `needs 21.1 GB of 36 GB, 24.3 GB free`, or `no memory, about $0.40` for a paid arm. */
  memoryLine: string;
  bar: MemoryBar | null;
  /** The verdict tag, such as `TIGHT`, or `PAID` for a cloud arm. */
  tag: { text: string; tone: Tone };
  reason: string;
  /** False for a verdict that never runs. There is no override: this is the case that froze the Mac. */
  canTick: boolean;
  /** True when the arm runs only after "I saved my work". */
  needsSaved: boolean;
  paid: boolean;
  costUsd: number | null;
  asks: number;
  minutes: number | null;
};

export const SAVED_WORK_TEXT = "I saved my work. Run although memory is tight.";

const NO_RUN: Record<string, string> = {
  too_big: "Does not fit on this Mac with this model. Pick a smaller model for this arm, or leave it out.",
  no_room: "Not enough memory is free now. Loading the model would make the Mac swap until it stops answering.",
  unknown: "The memory could not be read, so it will not run to be safe.",
};
const TIGHT_TEXT = "It fits, but it takes more than half of the memory. Save your work in other apps first.";
const PAID_TEXT = "Costs money. Helpers go to the same model or a cheaper one.";

const gb = (value: number): string => `${Math.round(value * 10) / 10} GB`;

/** `local-32k` as `Local 32K`. */
export function armLabel(name: string): string {
  return name
    .split("-")
    .map((part, at) => (/^\d+k$/i.test(part) ? part.toUpperCase() : at === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function roundedCost(usd: number): string {
  return usd < 1 ? `$${usd.toFixed(2)}` : `$${Math.round(usd * 10) / 10}`;
}

/** One arm of `evals.plan` as a row of the list. */
export function armRow(arm: EvalPlanArm): ArmRow {
  const paid = arm.kind === "cloud";
  const base = {
    name: arm.name,
    title: arm.label.length > 0 ? arm.label : armLabel(arm.name),
    model: arm.model,
    choices: (arm.choices ?? []).map((choice) => ({ ref: choice.ref, label: choice.size_gb == null ? choice.ref : `${choice.ref} · ${gb(choice.size_gb)}` })),
    asks: arm.asks,
    minutes: arm.minutes ?? null,
    costUsd: arm.cost_usd ?? null,
  };
  if (paid) {
    const cost = arm.cost_usd == null ? "cost not known" : `about ${roundedCost(arm.cost_usd)}`;
    return { ...base, memoryLine: `no memory, ${cost}`, bar: null, tag: { text: "PAID", tone: "view" }, reason: arm.reason ?? PAID_TEXT, canTick: true, needsSaved: false, paid: true };
  }
  const verdict = arm.verdict ?? "unknown";
  const need = arm.needed_gb;
  const ram = arm.ram_gb;
  const free = arm.free_gb;
  const memoryLine =
    need == null || ram == null || free == null ? "memory could not be read" : `needs ${gb(need)} of ${gb(ram)}, ${gb(free)} free`;
  let bar: MemoryBar | null = null;
  if (need != null && ram != null && ram > 0 && free != null) {
    const other = Math.min(1, Math.max(0, (ram - free) / ram));
    bar = { other, need: Math.min(1,Math.max(0, need / ram)), tone: verdict === "fits" || verdict === "tight" ? "ok" : "bad" };
  }
  const tags: Record<string, { text: string; tone: Tone }> = {
    fits: { text: "FITS", tone: "ok" },
    tight: { text: "TIGHT", tone: "act" },
    too_big: { text: "TOO BIG", tone: "bad" },
    no_room: { text: "NO ROOM NOW", tone: "bad" },
    unknown: { text: "NOT KNOWN", tone: "bad" },
  };
  const canTick = verdict === "fits" || verdict === "tight";
  const reason = arm.reason ?? (verdict === "tight" ? TIGHT_TEXT : (NO_RUN[verdict] ?? ""));
  return { ...base, memoryLine, bar, tag: tags[verdict] ?? { text: "NOT KNOWN", tone: "bad" }, reason, canTick, needsSaved: verdict === "tight", paid: false };
}

export function armRows(arms: readonly EvalPlanArm[]): ArmRow[] {
  return arms.map(armRow);
}

/** What the page says above the arms when no local arm can run now. */
export function noRoomLine(rows: readonly ArmRow[]): string | null {
  const local = rows.filter((row) => !row.paid);
  if (local.length === 0 || local.some((row) => row.canTick)) return null;
  return "No local arm can run now. Close other apps and check again, or run the paid arms only. golem will not start a run that would freeze the Mac.";
}

export type StartPlan = {
  /** Start is on. */
  canStart: boolean;
  /** The arms to send. */
  arms: string[];
  /** `allow_tight` to send. */
  allowTight: boolean;
  /** True when a ticked arm is tight and the "I saved my work" box shows as needed. */
  needsSaved: boolean;
  /** The line next to Start. */
  line: string;
};

/** The runs of an arm: each ask is played twice, with helpers and without. */
const runsOf = (row: ArmRow): number => row.asks * 2;

/** The line and the switch of Start, from what is ticked, whether the box is ticked, and whether one runs now. */
export function startPlan(rows: readonly ArmRow[], ticked: ReadonlySet<string>, saved: boolean, running: boolean): StartPlan {
  const chosen = rows.filter((row) => ticked.has(row.name));
  const needsSaved = chosen.some((row) => row.needsSaved);
  const arms = chosen.map((row) => row.name);
  const off = (line: string): StartPlan => ({ canStart: false, arms, allowTight: false, needsSaved, line });
  if (running) return off("Wait for the running one, or stop it");
  if (chosen.length === 0) return off("Nothing chosen yet");
  if (chosen.some((row) => !row.canTick)) return off("An arm that does not fit is ticked");
  if (needsSaved && !saved) return off("Tick the box on the left to go on");
  const runs = chosen.reduce((sum, row) => sum + runsOf(row), 0);
  const minutes = chosen.reduce<number | null>((sum, row) => (row.minutes === null ? sum : (sum ?? 0) + row.minutes), null);
  const priced = chosen.filter((row) => row.paid);
  const cost = priced.length === 0 ? "$0" : priced.some((row) => row.costUsd === null) ? "a cost not known" : `about ${roundedCost(priced.reduce((sum, row) => sum + (row.costUsd ?? 0), 0))}`;
  const parts = [`${runs} runs`];
  if (minutes !== null) parts.push(`about ${Math.max(1, Math.round(minutes))} min`);
  parts.push(cost);
  if (chosen.some((row) => !row.paid)) parts.push("one model, one request at a time");
  return { canStart: true, arms, allowTight: needsSaved && saved, needsSaved, line: parts.join(" · ") };
}

// --- the list of measurements

export type MeasureStatus = { text: string; mark: string; tone: Tone };

const STATUS: Record<EvalSummary["state"], MeasureStatus> = {
  running: { text: "Running", mark: "●", tone: "act" },
  stopped: { text: "Stopped", mark: "■", tone: "bad" },
  done: { text: "Done", mark: "✓", tone: "ok" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number): string => String(n).padStart(2, "0");

/** `Today 14:02` for today, else `21 Nov`. */
export function whenText(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const today = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return today ? `Today ${two(at.getHours())}:${two(at.getMinutes())}` : `${at.getDate()} ${MONTHS[at.getMonth()] ?? ""}`;
}

/** `Local 32K · qwen3.8:27b`, one per arm, joined by a comma. */
export function armsText(arms: readonly { name: string; model: string }[]): string {
  return arms.map((arm) => `${armLabel(arm.name)} · ${arm.model}`).join(", ");
}

export type MeasureListRow = {
  id: string;
  status: MeasureStatus;
  when: string;
  arms: string;
  note: string;
  running: boolean;
};

function noteOf(item: EvalSummary): string {
  if (item.state === "running") return `run ${Math.min(item.runs_played + 1, item.runs_total)} of ${item.runs_total}`;
  const parts: string[] = [];
  if (item.state === "stopped") parts.push(item.stop_reason ?? "stopped", `${item.runs_played} of ${item.runs_total} runs kept`);
  else parts.push(`${item.runs_total} runs`);
  if (item.cost_usd != null && item.cost_usd > 0) parts.push(formatUsd(item.cost_usd));
  if (item.state === "done") parts.push(item.in_use === true ? "its numbers are in use" : item.proposes != null && item.proposes > 0 ? `proposes ${item.proposes} ${item.proposes === 1 ? "number" : "numbers"}` : "numbers not used");
  return parts.join(" · ");
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** The measurements as lines, a running one first and the rest in the order they came (newest first). */
export function measureList(items: readonly EvalSummary[], now: Date = new Date()): MeasureListRow[] {
  const rows = items.map((item) => ({ id: item.id, status: STATUS[item.state], when: whenText(item.started_at, now), arms: armsText(item.arms), note: noteOf(item), running: item.state === "running" }));
  return [...rows.filter((row) => row.running), ...rows.filter((row) => !row.running)];
}

/** The id of the measurement that runs now, from the list, or null. */
export function runningId(items: readonly EvalSummary[]): string | null {
  return items.find((item) => item.state === "running")?.id ?? null;
}

// --- the reducer

/** What the run view shows beside the runs: the run that plays now and the memory reading. */
export type MeasureLive = {
  id: string;
  index: number;
  total: number;
  arm: string;
  mode: "on" | "off";
  ask: string;
  elapsed: number;
  memoryUsedGb: number | null;
  memoryTotalGb: number | null;
};

const sameRun = (run: EvalRun, p: EvalProgress): boolean => run.arm === p.arm && run.mode === p.mode && run.ask === p.ask;

/**
 * Folds `eval.started`, `eval.progress` and `eval.ended` into a measurement read before. An update of another
 * measurement leaves it as it was. A measurement not read yet (null) is made from `eval.started` and stays
 * without runs until `evals.get` fills them, but `eval.progress` adds the run it names.
 */
export function foldEval(current: EvalMeasurement | null, update: EvalUpdate): EvalMeasurement | null {
  if (update.kind === "started") {
    const s = update.started;
    if (current === null || current.id !== s.id) return { id: s.id, arms: s.arms, runs: [], started_at: s.started_at, state: "running" };
    // A resumed measurement runs again: the runs it did not play wait.
    return { ...current, state: "running", stop_reason: null, ended_at: null, runs: current.runs.map((run) => (run.end === "not_run" ? { ...run, end: "pending" as const } : run)) };
  }
  if (current === null) return null;
  if (update.kind === "progress") {
    const p = update.progress;
    if (p.id !== current.id) return current;
    const found = current.runs.some((run) => sameRun(run, p));
    const runs = found
      ? current.runs.map((run) => (sameRun(run, p) ? { ...run, end: p.state } : run))
      : [...current.runs, { arm: p.arm, ask: p.ask, mode: p.mode, end: p.state }];
    return { ...current, state: "running", runs };
  }
  const e = update.ended;
  if (e.id !== current.id) return current;
  return {
    ...current,
    state: e.state,
    stop_reason: e.state === "stopped" ? (e.stop_reason ?? null) : null,
    runs: current.runs.map((run) => (run.end === "pending" || run.end === "running" ? { ...run, end: "not_run" as const } : run)),
  };
}

/** The live reading after an update, for the measurement `id`. `eval.ended` clears it. */
export function foldLive(current: MeasureLive | null, update: EvalUpdate): MeasureLive | null {
  if (update.kind === "ended") return current !== null && current.id === update.ended.id ? null : current;
  if (update.kind === "started") return null;
  const p = update.progress;
  const keep = current !== null && current.id === p.id ? current : null;
  return {
    id: p.id,
    index: p.index,
    total: p.total,
    arm: p.arm,
    mode: p.mode,
    ask: p.ask,
    elapsed: p.elapsed,
    // A reading is only sent now and then: keep the last one until a new one comes.
    memoryUsedGb: p.memory_used_gb ?? keep?.memoryUsedGb ?? null,
    memoryTotalGb: p.memory_total_gb ?? keep?.memoryTotalGb ?? null,
  };
}

// --- the run

const FINISHED: ReadonlySet<EvalRun["end"]> = new Set(["completed", "failed", "cancelled", "timeout"]);

export type RunRow = {
  key: string;
  state: "done" | "failed" | "running" | "pending" | "not_run";
  mark: string;
  arm: string;
  ask: string;
  helpers: "on" | "off";
  /** Empty when the run has no result. */
  answer: string;
  time: string;
  windowLeft: string;
  started: string;
  /** A word in place of the numbers: `running`, `not run`, `failed`, and so on. */
  word: string;
};

export function mmss(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${two(whole % 60)}`;
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** One row of the table of runs. */
export function runRow(run: EvalRun, at: number): RunRow {
  const base = { key: `${run.arm}/${run.mode}/${run.ask}/${at}`, arm: run.arm, ask: run.ask, helpers: run.mode, answer: "", time: "", windowLeft: "", started: "" };
  if (run.end === "pending") return { ...base, state: "pending", mark: "○", word: "" };
  if (run.end === "running") return { ...base, state: "running", mark: "●", word: "running" };
  if (run.end === "not_run") return { ...base, state: "not_run", mark: "–", word: "not run" };
  const result = {
    answer: run.quality == null ? "" : run.quality.toFixed(2),
    time: run.seconds == null ? "" : mmss(run.seconds),
    windowLeft: run.window_left == null ? "" : percent(run.window_left),
    started: run.mode === "on" ? String(run.helpers_started ?? "–") : "–",
  };
  if (run.end === "completed") return { ...base, ...result, state: "done", mark: "✓", word: "" };
  const words = { failed: "failed", cancelled: "stopped", timeout: "took too long" } as const;
  return { ...base, ...result, state: "failed", mark: "✗", word: words[run.end] };
}

export function runRows(measurement: EvalMeasurement): RunRow[] {
  return measurement.runs.map(runRow);
}

/** How many runs are played (they have an end) and how many there are. */
export function runCounts(measurement: EvalMeasurement, live: MeasureLive | null = null): { played: number; total: number } {
  const played = measurement.runs.filter((run) => FINISHED.has(run.end)).length;
  const total = Math.max(measurement.runs.length, live !== null && live.id === measurement.id ? live.total : 0);
  return { played, total };
}

export type ProgressView = {
  /** `Run 7 of 20` */
  title: string;
  /** `helpers on · Read the whole repo` */
  what: string;
  /** 0 to 1. */
  share: number;
  /** `12:40 gone · about 18 min left` */
  time: string;
  /** `33.0 of 36 GB`, or null when no reading came. */
  memory: string | null;
  /** A reading of memory as shares for a bar, or null. */
  memoryShare: number | null;
};

/** The head of a running measurement: which run, how far, how long, and the memory now. */
export function progressView(measurement: EvalMeasurement, live: MeasureLive | null): ProgressView {
  const { played, total } = runCounts(measurement, live);
  const now = measurement.runs.find((run) => run.end === "running");
  const at = Math.min(played + 1, Math.max(total, 1));
  const elapsed = live !== null && live.id === measurement.id ? live.elapsed : null;
  const left = elapsed !== null && played > 0 && total > played ? Math.max(1, Math.round(((elapsed / played) * (total - played)) / 60)) : null;
  const time = elapsed === null ? "" : left === null ? `${mmss(elapsed)} gone` : `${mmss(elapsed)} gone · about ${left} min left`;
  const arm = now?.arm ?? live?.arm ?? "";
  const mode = now?.mode ?? live?.mode ?? "off";
  const ask = now?.ask ?? live?.ask ?? "";
  const reading = live !== null && live.id === measurement.id ? live : null;
  const memory = reading === null || reading.memoryUsedGb === null || reading.memoryTotalGb === null ? null : `${gb(reading.memoryUsedGb)} of ${gb(reading.memoryTotalGb)}`.replace(/ GB of/, " of");
  return {
    title: `Run ${at} of ${Math.max(total, 1)}`,
    what: ask === "" ? "" : `helpers ${mode} · ${ask}${arm === "" ? "" : ` · ${armLabel(arm)}`}`,
    share: total === 0 ? 0 : Math.min(1, (played + 0.5) / total),
    time,
    memory,
    memoryShare: reading === null || reading.memoryUsedGb === null || reading.memoryTotalGb === null || reading.memoryTotalGb <= 0 ? null : Math.min(1, reading.memoryUsedGb / reading.memoryTotalGb),
  };
}

// --- the stopped run

export type StoppedView = {
  /** `Stopped after 4 of 20 runs.` */
  title: string;
  /** The reason, in plain text, and what is kept. */
  detail: string;
  /** The label of the button that plays the rest, or null when nothing is left. */
  resume: string | null;
  left: number;
};

export function stoppedView(measurement: EvalMeasurement): StoppedView {
  const { played, total } = runCounts(measurement);
  const left = measurement.runs.filter((run) => run.end === "not_run" || run.end === "pending").length;
  const why = measurement.stop_reason ?? "It was stopped.";
  const kept = `${played} ${played === 1 ? "run is" : "runs are"} kept.`;
  const rest = left === 0 ? "" : ` ${left} ${left === 1 ? "was" : "were"} not run and ${left === 1 ? "is" : "are"} not counted.`;
  const proposal = measurement.proposal == null ? " There is not enough data for a proposal." : "";
  return { title: `Stopped after ${played} of ${total} runs.`, detail: `${why} ${kept}${rest}${proposal}`, resume: left === 0 ? null : `Run the other ${left}`, left };
}

// --- the result

export type ResultRow = {
  ask: string;
  /** `0.80 → 0.91`, and so on; a dash for a side that has no result. */
  answer: string;
  time: string;
  windowLeft: string;
  helpers: string;
  verdict: { text: string; tone: Tone };
};

export type ResultTable = { arm: string; title: string; rows: ResultRow[] };

const pair = (a: string, b: string): string => `${a === "" ? "–" : a} → ${b === "" ? "–" : b}`;

/** Helpers won when the answer was better or clearly more of the window was left (15 points or more). */
export function helperVerdict(off: EvalRun, on: EvalRun): ResultRow["verdict"] {
  if ((on.helpers_started ?? 0) === 0) return { text: "NO HELPER", tone: "dim" };
  const better = (on.quality ?? 0) - (off.quality ?? 0) > 0;
  const room = (on.window_left ?? 0) - (off.window_left ?? 0) >= 0.15;
  return better || room ? { text: "HELPER WINS", tone: "ok" } : { text: "SAME", tone: "act" };
}

/** The table of a finished measurement: for each arm and ask the run without helpers against the run with them. */
export function resultTables(measurement: EvalMeasurement): ResultTable[] {
  const tables: ResultTable[] = [];
  const arms = [...new Set(measurement.runs.map((run) => run.arm))];
  for (const arm of arms) {
    const mine = measurement.runs.filter((run) => run.arm === arm);
    const asks = [...new Set(mine.map((run) => run.ask))];
    const rows: ResultRow[] = [];
    for (const ask of asks) {
      const off = mine.find((run) => run.ask === ask && run.mode === "off" && run.end === "completed");
      const on = mine.find((run) => run.ask === ask && run.mode === "on" && run.end === "completed");
      if (off === undefined || on === undefined) continue;
      const a = runRow(off, 0);
      const b = runRow(on, 0);
      rows.push({ ask, answer: pair(a.answer, b.answer), time: pair(a.time, b.time), windowLeft: pair(a.windowLeft, b.windowLeft), helpers: (on.helpers_started ?? 0) === 0 ? "–" : String(on.helpers_started), verdict: helperVerdict(off, on) });
    }
    if (rows.length > 0) tables.push({ arm, title: armLabel(arm), rows });
  }
  return tables;
}

/** The line over the table of a finished measurement. */
export function doneLine(measurement: EvalMeasurement): { title: string; detail: string } {
  const { played, total } = runCounts(measurement);
  const start = new Date(measurement.started_at).getTime();
  const end = measurement.ended_at == null ? Number.NaN : new Date(measurement.ended_at).getTime();
  const title = Number.isNaN(start) || Number.isNaN(end) ? "Done." : `Done in ${mmss((end - start) / 1000)}.`;
  const rows = resultTables(measurement).flatMap((table) => table.rows);
  const never = rows.filter((row) => row.verdict.text === "NO HELPER").length;
  const proposal = measurement.proposal;
  const wins = proposal == null ? rows.filter((row) => row.verdict.text === "HELPER WINS").length : proposal.wins;
  const pairs = proposal == null ? rows.length - never : proposal.pairs;
  const parts = [`${played} of ${total} runs.`, `Helpers gave a better answer or left clearly more window in ${wins} of ${pairs} asks`];
  parts[1] += never > 0 ? `, and were never started for ${never}.` : ".";
  return { title, detail: parts.join(" ") };
}

// --- the proposal

export type ProposalLine = {
  key: EvalNumber["key"];
  /** The current value as it is written: `30%`, `3×`. */
  current: string;
  /** The measured value, or null when the arms that ran could not tell. */
  proposed: string | null;
  changed: boolean;
  note: string;
  measured: boolean;
};

const KEY_ORDER: readonly EvalNumber["key"][] = ["read_share", "fill_share", "job_share", "price_ratio"];

function numberText(key: EvalNumber["key"], value: number): string {
  return key === "price_ratio" ? `${Math.round(value * 10) / 10}×` : percent(value);
}

/** The four numbers a measurement proposes, in a fixed order. */
export function proposalLines(measurement: EvalMeasurement): ProposalLine[] {
  const numbers = measurement.proposal?.numbers ?? [];
  const lines: ProposalLine[] = [];
  for (const key of KEY_ORDER) {
    const item = numbers.find((each) => each.key === key);
    if (item === undefined) continue;
    const proposed = item.measured && item.proposed != null ? numberText(key, item.proposed) : null;
    const current = numberText(key, item.current);
    lines.push({ key, current, proposed, changed: proposed !== null && proposed !== current, note: item.note ?? "", measured: item.measured });
  }
  return lines;
}

/** True when "Use these numbers" has something to write. */
export function canUseNumbers(measurement: EvalMeasurement): boolean {
  return measurement.state === "done" && measurement.in_use !== true && proposalLines(measurement).some((line) => line.measured);
}

/** The line next to the buttons of a finished measurement. */
export function doneFooter(measurement: EvalMeasurement): string {
  if (measurement.in_use === true) return "These numbers are in use. See them on the Rules tab.";
  if (proposalLines(measurement).some((line) => line.measured)) return "One run per ask. Measure again to see how much the numbers move.";
  return "Too little ran to propose a number.";
}
