import type { CostGetResult, CostTotals } from "@golem/client";

import type { ChatMessage } from "./chat-state.ts";
import { formatTokens } from "./context.ts";

/** What a run's model calls used: tokens and cost of the finished calls, model and tier of the last call. */
export type TurnTotals = {
  model: string | null;
  tier: "local" | "budget" | "frontier" | null;
  tokens: number | null;
  costUsd: number | null;
};

/** golem's estimate of a cost: `$0.00`, `$0.004` below a cent, `$0.31`. Empty when unknown. */
export function formatCost(usd: number | null): string {
  if (usd === null) return "";
  if (usd === 0) return "$0.00";
  return usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

/** The sum over the finished calls of these steps. A total is null when no call had that number. */
export function turnTotals(steps: readonly ChatMessage[]): TurnTotals {
  let tokens: number | null = null;
  let costUsd: number | null = null;
  let model: string | null = null;
  let tier: TurnTotals["tier"] = null;
  for (const { call } of steps) {
    if (call === undefined) continue;
    if (call.model !== null) {
      model = call.model;
      tier = call.tier;
    }
    if (!call.done) continue;
    if (call.tokens !== null) tokens = (tokens ?? 0) + call.tokens;
    if (call.costUsd !== null) costUsd = (costUsd ?? 0) + call.costUsd;
  }
  return { model, tier, tokens, costUsd };
}

/**
 * The parts after the time and steps in a turn's footer: model, tier word (only `local`),
 * tokens, cost. A part that is unknown is left out. `modelPrefix` goes before the model, and
 * `routedNote` (from `routedNote` in route.ts) before that.
 */
export function turnFooterParts(totals: TurnTotals, modelPrefix = "", routedNote = ""): string[] {
  const parts: string[] = [];
  if (routedNote !== "") parts.push(routedNote);
  if (totals.model !== null && totals.model !== "") parts.push(`${modelPrefix}${totals.model}`);
  if (totals.tier === "local") parts.push("local");
  if (totals.tokens !== null) parts.push(`${formatTokens(totals.tokens)} tok`);
  const cost = formatCost(totals.costUsd);
  if (cost !== "") parts.push(cost);
  return parts;
}

/** For the status line: `$0.03`, the session's cost so far, once it has a paid call. Empty before that. */
export function sessionCostLabel(messages: readonly ChatMessage[]): string {
  const total = turnTotals(messages).costUsd;
  return total === null || !(total > 0) ? "" : formatCost(total);
}

/** `38.2K`, `1.4M`: a token count for a report. */
export function formatCount(count: number): string {
  return count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : formatTokens(count);
}

/** The model of a `provider/model` ref: what the saved line and tile name. */
export function referenceName(ref: string): string {
  const at = ref.indexOf("/");
  return at < 0 ? ref : ref.slice(at + 1);
}

/** A table with its columns padded by spaces. The first column is left, the rest as `right` says. */
function table(rows: string[][], right: readonly boolean[]): string[] {
  const widths = rows[0]!.map((_, at) => Math.max(...rows.map((row) => row[at]!.length)));
  return rows.map((row) =>
    row
      .map((cell, at) => (right[at] === true ? cell.padStart(widths[at]!) : cell.padEnd(widths[at]!)))
      .join("  ")
      .trimEnd(),
  );
}

/**
 * `/cost` and `golem cost` as plain lines: tokens and cost for the session (when the result has
 * one), today and the week, the week by model, and what running locally saved.
 */
export function costReportLines(result: CostGetResult): string[] {
  const totals = (label: string, span: CostTotals): string[] => [
    label,
    formatCount(span.input),
    formatCount(span.output),
    formatCost(span.cost_usd),
  ];
  const spans: string[][] = [["cost", "in", "out", "cost"]];
  if (result.session != null) spans.push(totals("this session", result.session));
  spans.push(totals("today", result.today), totals("this week", result.week));
  const lines = table(spans, [false, true, true, true]);
  const models = result.by_model ?? [];
  if (models.length > 0) {
    lines.push(
      "",
      "by model (7 days)",
      ...table(
        models.map((row) => [
          row.model ?? "unknown",
          row.tier ?? "-",
          formatCount(row.input + row.output),
          formatCost(row.cost_usd),
        ]),
        [false, false, true, true],
      ),
    );
  }
  const reference = result.saved_reference;
  if (reference != null && reference !== "") {
    const saved = formatCost(result.week.saved_usd);
    lines.push("", `saved \u2248 ${saved} by running locally (against ${referenceName(reference)} prices)`);
  }
  return lines;
}
