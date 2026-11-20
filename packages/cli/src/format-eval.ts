import type { EvalRoutingResult, EvalScenarioRow } from "../../protocol/gen/eval-routing-result.ts";

const DASH = "–";
const HEADS = ["", "cost", "cut prompts", "step-ups", "peak ctx"];

/** The arguments of `golem eval routing`, or null for a wrong one. */
export function parseEvalArgs(args: string[]): { days?: number; sessionId?: string } | null {
  const found: { days?: number; sessionId?: string } = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined || value.length === 0) return null;
    if (flag === "--days" && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 3650) {
      found.days = Number(value);
    } else if (flag === "--session" && !value.startsWith("-")) {
      found.sessionId = value;
    } else {
      return null;
    }
  }
  return found;
}

function money(usd: number): string {
  return usd > 0 && usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

function share(row: EvalScenarioRow): string {
  return row.peak_share === null || row.peak_share === undefined ? DASH : `${Math.round(row.peak_share * 100)}%`;
}

function plural(value: number, word: string): string {
  return `${count(value)} ${word}${value === 1 ? "" : "s"}`;
}

/** The report of `eval.routing` as a table. It has counts and money only, never message text. */
export function formatEvalRouting(report: EvalRoutingResult): string {
  const head = `${plural(report.days, "day")} · ${plural(report.sessions, "session")} · ${plural(report.calls, "model call")}`;
  if (report.calls === 0) {
    return `${head}\nno recorded model call could be sized${report.skipped > 0 ? ` (${count(report.skipped)} skipped)` : ""}`;
  }
  const rows: string[][] = [HEADS];
  for (const row of report.scenarios ?? []) {
    rows.push([
      row.name,
      money(row.cost_usd),
      count(row.cuts),
      row.step_ups === null || row.step_ups === undefined ? DASH : count(row.step_ups),
      share(row),
    ]);
  }
  rows.push([report.actual.name, money(report.actual.cost_usd), count(report.actual.cuts)]);
  const widths = HEADS.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  const lines = rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd((widths[column] ?? 0) + 2))
      .join("")
      .trimEnd(),
  );
  const notes: string[] = [];
  if (report.skipped > 0) {
    notes.push(`${plural(report.skipped, "model call")} skipped: no sizes recorded, or the call failed`);
  }
  const top = report.top ?? [];
  if (top.length > 0) {
    notes.push("", "where auto would have spent most:");
    for (const item of top) {
      notes.push(`  ${item.session_id}  ${money(item.cost_usd)}  ${plural(item.calls, "call")}`);
    }
  }
  const helpers = report.helpers ?? [];
  if (helpers.length > 0) {
    notes.push("", "helpers, as they ran and what the pick gives now:");
    for (const item of helpers) {
      const asks = item.would_asks ? ", asks first" : "";
      notes.push(
        `  ${item.session_id}  ${item.agent}  wish ${item.wish}  ran on ${item.ran} (${item.ran_why})  would run on ${item.would} (${item.would_why}${asks})`,
      );
    }
  }
  return [head, ...lines, ...(notes.length > 0 ? ["", ...notes] : [])].join("\n");
}
