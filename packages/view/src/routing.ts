/** The words and small rules of Settings › Routing, for every client that shows them. */

export type RouteMode = "pinned" | "local" | "auto";
export type PaidChoice = "ask" | "always_ask" | "never";
export type OverChoice = "local" | "ask";

export type RoutingChoice<T extends string> = { value: T; title: string; line: string };

export const ROUTE_MODES: readonly RoutingChoice<RouteMode>[] = [
  { value: "pinned", title: "Pinned", line: "A chat uses the one model you picked for it." },
  { value: "local", title: "Local only", line: "A chat uses models on this Mac only. Nothing goes to a hosted provider." },
  { value: "auto", title: "Auto", line: "golem starts on this Mac and uses a hosted model only when a rule allows it." },
];

export const PAID_CHOICES: readonly RoutingChoice<PaidChoice>[] = [
  { value: "ask", title: "Ask once per session", line: "golem asks before the first paid call and remembers your answer for the session." },
  { value: "always_ask", title: "Always ask", line: "golem asks before every paid call and remembers nothing." },
  { value: "never", title: "Never", line: "Paid models are never used." },
];

export const OVER_CHOICES: readonly RoutingChoice<OverChoice>[] = [
  { value: "local", title: "Stay local", line: "Over a cap, the turn runs on a model on this Mac." },
  { value: "ask", title: "Ask me", line: "Over a cap, golem asks before a paid call." },
];

export const LOCAL_ONLY_CAPTION = "Chats in these folders never leave this Mac.";

/** The three tiers of the ladder, with what each holds. */
export const LADDER_TIERS = [
  { tier: "local", title: "Local", line: "Runs on this Mac, free." },
  { tier: "budget", title: "Budget", line: "A hosted model at or below the price limit." },
  { tier: "frontier", title: "Frontier", line: "A stronger hosted model." },
] as const;

export const ROLES = [
  { role: "titles", title: "Titles", line: "Names for new chats." },
  { role: "summarise", title: "Summaries", line: "The summary that /compact makes." },
  { role: "explore", title: "Explorer", line: "Looking through files for a question." },
] as const;

function modelName(ref: string): string {
  const at = ref.indexOf("/");
  return at < 0 ? ref : ref.slice(at + 1);
}

/** `Picked for you: qwen3:27b`, or what to say when golem has nothing to pick. */
export function pickedLine(ref: string | null): string {
  return ref === null ? "Picked for you: nothing is ready" : `Picked for you: ${modelName(ref)}`;
}

/** A window size the way a person says it: `32K` for 32768, `41.5K` for 41500, `900` below 1000. */
export function windowSize(tokens: number): string {
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(tokens);
}

/**
 * What Auto gives for a local model on this Mac: `Auto picks 32K for qwen3:27b on this Mac (36 GB).`
 * Null when golem has no plan for the model, so there is nothing to say.
 */
export function windowCaption(model: string | null, tokens: number | null, ramGb: number | null): string | null {
  if (model === null || tokens === null) return null;
  const memory = ramGb === null ? "" : ` (${Math.round(ramGb)} GB)`;
  return `Auto picks ${windowSize(tokens)} for ${modelName(model)} on this Mac${memory}.`;
}

export type Parsed = { ok: true; value: number | null } | { ok: false; message: string };

/** A number typed in a box. Empty is null, which clears the setting. */
export function parseAmount(text: string): Parsed {
  const trimmed = text.trim().replace(/^\$/, "");
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, message: "Enter a number." };
  return { ok: true, value };
}

/** A share of the window, 0.7, as the percent a person types, 70. */
export function toPercent(share: number): string {
  return String(Math.round(share * 10_000) / 100);
}

/** The percent a person typed, `70` or `70%`, as a share, 0.7. */
export function parsePercent(text: string): Parsed {
  const parsed = parseAmount(text.trim().replace(/%$/, ""));
  if (!parsed.ok || parsed.value === null) return parsed;
  return { ok: true, value: Math.round(parsed.value * 100) / 10_000 };
}
