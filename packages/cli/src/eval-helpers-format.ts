import type { EvalMeasurement } from "../../protocol/gen/evals-get-result.ts";
import type { EvalPlanArm } from "../../protocol/gen/eval-plan-arm.ts";
import type { EvalProgress } from "../../protocol/gen/eval-progress.ts";
import type { EvalRun } from "../../protocol/gen/eval-run.ts";
import type { EvalSummary } from "../../protocol/gen/eval-summary.ts";

const DASH = "-";
const BASE = "golem eval helpers";

export const HELPERS_USAGE =
  "usage: golem eval helpers [--arm <name>]… [--model <arm>=<model>]… [--allow-tight]\n" +
  "       golem eval helpers list | show <id> | stop [<id>] | resume <id> [--allow-tight] | apply <id> | delete <id>";

export type HelpersArgs =
  | { kind: "start"; arms: string[]; models: Record<string, string>; allowTight: boolean }
  | { kind: "list" }
  | { kind: "show"; id: string }
  | { kind: "stop"; id?: string }
  | { kind: "resume"; id: string; allowTight: boolean }
  | { kind: "apply"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "error" };

const BAD: HelpersArgs = { kind: "error" };

function isId(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !value.startsWith("-");
}

/**
 * What follows `golem eval helpers` (or `golem eval` itself, for the sub-commands).
 * `golem eval helpers` with no arm is the plan.
 */
export function parseHelpersArgs(args: readonly string[]): HelpersArgs {
  const [first, ...rest] = args;
  switch (first) {
    case "list":
      return rest.length === 0 ? { kind: "list" } : BAD;
    case "show":
    case "apply":
    case "delete":
      return rest.length === 1 && isId(rest[0]) ? { kind: first, id: rest[0] } : BAD;
    case "stop":
      if (rest.length === 0) return { kind: "stop" };
      return rest.length === 1 && isId(rest[0]) ? { kind: "stop", id: rest[0] } : BAD;
    case "resume": {
      const allowTight = rest.includes("--allow-tight");
      const ids = rest.filter((arg) => arg !== "--allow-tight");
      return ids.length === 1 && isId(ids[0]) ? { kind: "resume", id: ids[0], allowTight } : BAD;
    }
    default:
      return parseStart(args);
  }
}

function parseStart(args: readonly string[]): HelpersArgs {
  const arms: string[] = [];
  const models: Record<string, string> = {};
  let allowTight = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "--allow-tight") {
      allowTight = true;
    } else if (arg === "--arm") {
      const value = args[i + 1];
      if (!isId(value)) return BAD;
      if (!arms.includes(value)) arms.push(value);
      i += 1;
    } else if (arg === "--model") {
      const value = args[i + 1] ?? "";
      const cut = value.indexOf("=");
      if (cut < 1 || cut === value.length - 1) return BAD;
      models[value.slice(0, cut)] = value.slice(cut + 1);
      i += 1;
    } else {
      return BAD;
    }
  }
  return { kind: "start", arms, models, allowTight };
}

// ---------------------------------------------------------------- plan

const VERDICT_WORDS: Record<string, string> = {
  fits: "fits",
  tight: "tight",
  too_big: "too big",
  no_room: "no room now",
  unknown: "unknown",
};

/** The verdict as a word. A model Ollama does not have is `unknown` on the wire; its reason tells it apart. */
function verdictWord(arm: EvalPlanArm): string {
  if (arm.verdict === "unknown" && (arm.reason ?? "").startsWith("Ollama does not have ")) return "not installed";
  return VERDICT_WORDS[arm.verdict ?? "unknown"] ?? "unknown";
}

function gb(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : `${value.toFixed(1)} GB`;
}

function windowText(tokens: number): string {
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens);
}

function money(usd: number): string {
  return usd > 0 && usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

/** The memory line of a local arm: `memory  qwen3.8:27b at 32K needs 21.1 GB · 24.3 GB free of 36 GB · tight`. */
export function memoryLine(arm: EvalPlanArm): string {
  const total = arm.ram_gb === null || arm.ram_gb === undefined ? DASH : `${Math.round(arm.ram_gb)} GB`;
  const verdict = verdictWord(arm);
  return `memory  ${arm.model} at ${windowText(arm.window)} needs ${gb(arm.needed_gb)} · ${gb(arm.free_gb)} free of ${total} · ${verdict}`;
}

/** What an arm is, then its memory (local) or cost (paid) and the reason. */
export function formatPlanArm(arm: EvalPlanArm): string[] {
  const parts = [arm.kind, arm.model, `${windowText(arm.window)} window`, `${arm.asks} asks`];
  if (arm.minutes !== null && arm.minutes !== undefined) parts.push(`about ${Math.round(arm.minutes)} min`);
  const lines = [`${arm.name}  (${parts.join(", ")})`];
  if (arm.kind === "local") {
    lines.push(`  ${memoryLine(arm)}`);
  } else if (arm.cost_usd !== null && arm.cost_usd !== undefined) {
    lines.push(`  cost    about ${money(arm.cost_usd)} for all its runs (paid)`);
  } else {
    lines.push("  cost    paid, no estimate");
  }
  if (arm.reason) lines.push(`          ${arm.reason}`);
  return lines;
}

/** The plan: each arm, and what to run. Nothing was started. */
export function formatPlan(arms: readonly EvalPlanArm[], running: string | null | undefined): string {
  const lines: string[] = [];
  for (const arm of arms) lines.push(...formatPlanArm(arm));
  lines.push("");
  if (running) {
    lines.push(`A measurement is running in the service: ${BASE} show ${running}`);
  }
  const names = arms.map((arm) => arm.name);
  const first = names[0];
  if (first !== undefined) {
    lines.push(`start one with: ${BASE} --arm ${first}   (arms: ${names.join(", ")})`);
  }
  if (arms.some((arm) => arm.verdict === "tight")) {
    lines.push("a tight arm needs --allow-tight: save your work in other apps first");
  }
  lines.push("nothing was started.");
  return lines.join("\n");
}

/** One line for each requested arm that may not run, with what to do. Empty when all may run. */
export function refusals(
  plan: readonly EvalPlanArm[],
  requested: readonly string[],
  allowTight: boolean,
): string[] {
  const names = plan.map((arm) => arm.name);
  const out: string[] = [];
  for (const name of requested) {
    const arm = plan.find((candidate) => candidate.name === name);
    if (arm === undefined) {
      out.push(`unknown arm ${name} (arms: ${names.join(", ")})`);
      continue;
    }
    const why = arm.reason ? `: ${arm.reason}` : "";
    if (arm.kind !== "local") continue;
    if (arm.verdict === "tight") {
      if (!allowTight) {
        out.push(`${name} is tight on memory${why}. Save your work in other apps, then run again with --allow-tight.`);
      }
    } else if (arm.verdict !== "fits") {
      const word = verdictWord(arm);
      out.push(`${name} cannot run (${word})${why}`);
    }
  }
  return out;
}

/** The paid arms among the requested ones, as a line, or null when none is paid. */
export function costLine(plan: readonly EvalPlanArm[], requested: readonly string[]): string | null {
  const paid = plan.filter((arm) => arm.kind === "cloud" && requested.includes(arm.name));
  if (paid.length === 0) return null;
  return paid
    .map((arm) => `${arm.name}: ${arm.cost_usd === null || arm.cost_usd === undefined ? "paid, no estimate" : `about ${money(arm.cost_usd)}`}`)
    .join(" · ")
    .replace(/^/, "cost    ");
}

// ---------------------------------------------------------------- progress

/** `0:42`, `12:40`, `1:02:03`. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** `run 3 of 20  local-32k  on  ask-name  completed  0:42  mem 21.1/36 GB` */
export function formatProgress(progress: EvalProgress): string {
  const parts = [
    `run ${progress.index + 1} of ${progress.total}`,
    progress.arm,
    progress.mode,
    progress.ask,
    progress.state,
    clock(progress.elapsed),
  ];
  const used = progress.memory_used_gb;
  const total = progress.memory_total_gb;
  if (used !== null && used !== undefined && total !== null && total !== undefined) {
    parts.push(`mem ${used.toFixed(1)}/${Math.round(total)} GB`);
  }
  return parts.join("  ");
}

// ---------------------------------------------------------------- list, show

const PLAYED = new Set(["completed", "failed", "cancelled", "timeout"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `today 14:02`, or `21 Nov` for another day. `now` decides what today is. */
export function whenText(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const same = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return same ? `today ${pad2(at.getHours())}:${pad2(at.getMinutes())}` : `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

function detail(item: EvalSummary): string {
  if (item.state === "running") return `run ${Math.min(item.runs_played + 1, item.runs_total)} of ${item.runs_total}`;
  if (item.state === "stopped") return item.stop_reason ?? "stopped";
  const parts = [`${item.runs_total} runs`];
  if (item.cost_usd !== null && item.cost_usd !== undefined && item.cost_usd > 0) parts.push(money(item.cost_usd));
  if (item.in_use) parts.push("in use");
  return parts.join(" · ");
}

function align(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, column) => {
      widths[column] = Math.max(widths[column] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join("  ")
      .trimEnd(),
  );
}

/** `golem eval helpers list`: one line for each measurement, the newest first. */
export function formatList(items: readonly EvalSummary[], now: Date): string {
  if (items.length === 0) return `no measurement yet. ${BASE} shows the plan.`;
  const rows = items.map((item) => [
    item.id,
    whenText(item.started_at, now),
    item.arms.map((arm) => arm.name).join(","),
    item.state,
    detail(item),
  ]);
  return [...align(rows), "", `${BASE} show <id>   the table`].join("\n");
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function num(value: number | null, digits: number): string {
  return value === null ? DASH : value.toFixed(digits);
}

/** The averages of the runs of each arm and mode that were played. */
export function formatRunTable(runs: readonly EvalRun[]): string[] {
  const rows: string[][] = [["arm", "helpers", "runs", "quality", "time", "window left", "helpers started"]];
  const groups = new Map<string, EvalRun[]>();
  for (const run of runs) {
    const key = `${run.arm}\u0000${run.mode}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const played = group.filter((run) => PLAYED.has(run.end));
    const finite = (pick: (run: EvalRun) => number | null | undefined): number[] =>
      played.map(pick).filter((value): value is number => typeof value === "number");
    const seconds = mean(finite((run) => run.seconds));
    const windowLeft = mean(finite((run) => run.window_left));
    rows.push([
      first.arm,
      first.mode,
      `${played.length}/${group.length}`,
      num(mean(finite((run) => run.quality)), 2),
      seconds === null ? DASH : clock(seconds),
      windowLeft === null ? DASH : `${Math.round(windowLeft * 100)}%`,
      num(mean(finite((run) => run.helpers_started)), 1),
    ]);
  }
  return align(rows);
}

/** The proposal for `[agents.delegate]`: the current value, and the measured one or why there is none. */
export function formatProposal(measurement: EvalMeasurement): string[] {
  const proposal = measurement.proposal;
  if (proposal === null || proposal === undefined) {
    return ["no proposal: too little ran to propose anything"];
  }
  const rows = proposal.numbers.map((item) => {
    const proposed = item.proposed;
    const change = item.measured && proposed !== null && proposed !== undefined ? `${item.current} -> ${proposed}` : `${item.current}`;
    const note = item.measured ? (item.note ?? "") : `not measured${item.note ? `: ${item.note}` : ""}`;
    return [`  ${item.key}`, change, note];
  });
  return [
    "proposed for [agents.delegate]",
    ...align(rows),
    `helpers did better in ${proposal.wins} of ${proposal.pairs} paired asks`,
  ];
}

/** The seconds between the start and the end of a measurement, or null while it runs. */
export function duration(measurement: EvalMeasurement): number | null {
  if (measurement.ended_at === null || measurement.ended_at === undefined) return null;
  const span = (new Date(measurement.ended_at).getTime() - new Date(measurement.started_at).getTime()) / 1000;
  return Number.isFinite(span) ? span : null;
}

/** `golem eval helpers show <id>`: the state, the table and the proposal. */
export function formatMeasurement(measurement: EvalMeasurement): string {
  const played = measurement.runs.filter((run) => PLAYED.has(run.end)).length;
  const took = duration(measurement);
  const head = [`measurement ${measurement.id}`, measurement.state];
  if (took !== null) head[1] = `${measurement.state} in ${clock(took)}`;
  head.push(`${played} of ${measurement.runs.length} runs`);
  if (measurement.cost_usd !== null && measurement.cost_usd !== undefined && measurement.cost_usd > 0) {
    head.push(money(measurement.cost_usd));
  }
  const lines = [head.join(" · ")];
  if (measurement.state === "stopped" && measurement.stop_reason) {
    lines.push(`stopped: ${measurement.stop_reason}`);
  }
  lines.push("", ...formatRunTable(measurement.runs), "", ...formatProposal(measurement), "");
  if (measurement.state === "stopped") lines.push(`${BASE} resume ${measurement.id}   play the runs left`);
  if (measurement.state !== "running" && measurement.proposal) {
    lines.push(`${BASE} apply ${measurement.id}   write them to config.toml`);
  }
  lines.push(`${BASE} list   all measurements`);
  return lines.join("\n");
}
