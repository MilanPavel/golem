import { stepCount, type Detail } from "./activity.ts";
import { formatTokens } from "./context.ts";
import { formatCost, type TurnTotals } from "./cost.ts";
import { formatTurnTime } from "./duration.ts";

/** The parts of the line under an answer that a person can turn off, in the order of the line. */
export const FOOTER_PARTS = ["time", "steps", "model", "where", "tokens", "cost", "helpers"] as const;
export type FooterPart = (typeof FOOTER_PARTS)[number];

export function isFooterPart(value: unknown): value is FooterPart {
  return typeof value === "string" && (FOOTER_PARTS as readonly string[]).includes(value);
}

/** The words on the chips that pick the parts. */
export const FOOTER_PART_LABELS: Record<FooterPart, string> = {
  time: "Time",
  steps: "Steps",
  model: "Model",
  where: "Local or hosted",
  tokens: "Tokens",
  cost: "Cost",
  helpers: "Helpers",
};

/** Which parts are off, and whether a part that says nothing is left out. */
export type FooterChoice = { off: readonly FooterPart[]; leaveOutEmpty: boolean };

/** Every part on, and the parts that say nothing left out. */
export const DEFAULT_FOOTER: FooterChoice = { off: [], leaveOutEmpty: true };

/** What a turn's footer knows: the totals, the time of the last step and the number of tools. */
export type FooterSource = TurnTotals & { durationMs: number | undefined; tools: number };

/**
 * The line under an answer, as parts in order: time, steps, the routed note and model, `local`, tokens,
 * cost, helpers. A part that is unknown is left out, as is a part the choice turns off. With `leaveOutEmpty`,
 * a part that adds nothing goes too: `$0.00`, and the step count when Quiet already shows it.
 */
export function turnFooterLine(
  source: FooterSource,
  choice: FooterChoice = DEFAULT_FOOTER,
  options: { detail?: Detail; modelPrefix?: string; routedNote?: string } = {},
): string[] {
  const { detail = "normal", modelPrefix = "", routedNote = "" } = options;
  const keep = (part: FooterPart): boolean => !choice.off.includes(part);
  const parts: string[] = [];
  if (keep("time") && source.durationMs !== undefined) parts.push(formatTurnTime(source.durationMs));
  if (keep("steps") && source.tools > 0 && !(choice.leaveOutEmpty && detail === "quiet")) parts.push(stepCount(source.tools));
  if (keep("model")) {
    if (routedNote !== "") parts.push(routedNote);
    if (source.model !== null && source.model !== "") parts.push(`${modelPrefix}${source.model}`);
  }
  if (keep("where") && source.tier === "local") parts.push("local");
  if (keep("tokens") && source.tokens !== null) parts.push(`${formatTokens(source.tokens)} tok`);
  const cost = formatCost(source.costUsd);
  if (keep("cost") && cost !== "" && !(choice.leaveOutEmpty && source.costUsd === 0)) parts.push(cost);
  const helpers = source.helpers ?? 0;
  if (keep("helpers") && helpers > 0) parts.push(`${helpers} ${helpers === 1 ? "helper" : "helpers"}`);
  return parts;
}
