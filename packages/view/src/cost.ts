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
 * tokens, cost. A part that is unknown is left out. `modelPrefix` goes before the model.
 */
export function turnFooterParts(totals: TurnTotals, modelPrefix = ""): string[] {
  const parts: string[] = [];
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
