import type { ListedModel, ModelMemory, TraceContext, TraceMessage } from "@golem/client";

import { CHARS_PER_TOKEN, contextLevel, formatTokens, formatWindow } from "./context.ts";
import type { RouteMode } from "./route.ts";
import { formatExtraGb, memoryFor } from "./tune.ts";

// What a client offers when the context fills: the rows of the ctx chip's popover and of the key row
// of `/context`. Both clients show these words; neither writes its own (ADR-056).

export type ContextActionId = "clear" | "summarise" | "grow" | "larger";

export type ContextAction = {
  id: ContextActionId;
  /** The row's name: `Clear old tool results`. */
  label: string;
  /** What it costs, said before the choice: `frees ≈ 11K · no model call`. Empty when it cannot run. */
  consequence: string;
  enabled: boolean;
  /** Why the row cannot run, for a disabled one. */
  why?: string;
  /** The key of the `/context` key row. */
  key: "c" | "s" | "g" | "m";
  /** The row's name in the key row: `grow to 64K`. */
  short: string;
};

/** Where the window of the last call came from. */
export type WindowSource = "planned" | "user" | "ollama" | "unknown";

/** The steps a window grows through. The daemon's `GROW_STEPS`. */
export const GROW_STEPS: readonly number[] = [8192, 16384, 32768, 65536, 131072];

/** The tokens a cleared result still takes, as one line of stub. */
export const STUB_TOKENS = 15;

/** The tokens a summary takes, about. */
export const SUMMARY_TOKENS = 400;

export const CUT_BANNER = "The model no longer sees the start of this chat.";

/** Whether golem planned the window, someone set it, Ollama chose it, or nobody knows. */
export function windowSourceOf(call: { window: number | null; planned: boolean; numCtx: number | null }): WindowSource {
  if (call.window === null) return "unknown";
  if (call.planned) return "planned";
  return call.numCtx !== null ? "user" : "ollama";
}

/** `32K · planned by golem for this Mac`, `8K · set by you`, `≈ 32K · Ollama's default`. */
export function windowSourceLine(window: number | null, source: WindowSource): string {
  if (window === null || source === "unknown") return "window unknown";
  const size = formatWindow(window);
  if (source === "planned") return `${size} · planned by golem for this Mac`;
  if (source === "user") return `${size} · set by you`;
  return `≈ ${size} · Ollama's default`;
}

/** `18.6K of 32K · reply reserve 4K`, or the tokens alone when the window is unknown. */
export function contextFillLine(used: number, window: number | null, reserve: number | null): string {
  if (window === null) return `${formatTokens(used)} · window unknown`;
  const tail = reserve === null || reserve <= 0 ? "" : ` · reply reserve ${formatWindow(reserve)}`;
  return `${formatTokens(used)} of ${formatWindow(window)}${tail}`;
}

export type ContextActionsInput = {
  /** The tokens of the last call, and its window. */
  used: number | null;
  window: number | null;
  source: WindowSource;
  /** The session's model, as the session says it. */
  session: { profile: string | null; provider: string | null; name: string | null };
  /** The model list. Null while it is not read. */
  models: readonly ListedModel[] | null;
  /** The messages the last call sent. Null while they are not read. */
  messages: readonly TraceMessage[] | null;
  keepResults: number;
  keepTurns: number;
  /** This Mac's memory and the model's size, from `model.options.get`. Null when golem does not know. */
  memory: ModelMemory | null;
  route: RouteMode;
  /** The context changed after the last call, so its messages no longer say what is sent. */
  changed?: boolean;
  /** An answer is being written: nothing can change the context now. */
  busy: boolean;
};

function tokensOf(message: TraceMessage): number {
  return message.tokens ?? Math.ceil(message.text.length / CHARS_PER_TOKEN);
}

function listedFor(input: ContextActionsInput): ListedModel | undefined {
  const { profile, provider, name } = input.session;
  const ref = provider !== null && name !== null ? `${provider}/${name}` : null;
  return (input.models ?? []).find(
    (model) => (profile !== null && (model.ref === profile || (model.profiles ?? []).includes(profile))) || model.ref === ref,
  );
}

function modelName(input: ContextActionsInput): string {
  return listedFor(input)?.label ?? input.session.name ?? "the model";
}

/** Tool results that clearing would stub: all but the newest `keep`, and not already stubs. */
function clearable(messages: readonly TraceMessage[], keep: number): TraceMessage[] {
  const results = messages.filter((message) => message.role === "tool" && (message.original ?? null) === null);
  return results.slice(0, Math.max(0, results.length - keep));
}

/** Why the messages of the last call cannot be counted yet, or null when they can. */
function waiting(input: ContextActionsInput): string | null {
  if (input.busy) return "wait for the answer to finish";
  if (input.changed === true) return "changed just now: the next turn shows what is left";
  return input.messages === null ? "reading the last call" : null;
}

function clearAction(input: ContextActionsInput): ContextAction {
  const base = { id: "clear" as const, label: "Clear old tool results", key: "c" as const, short: "clear old results" };
  const wait = waiting(input);
  if (wait !== null) return { ...base, consequence: "", enabled: false, why: wait };
  const old = clearable(input.messages ?? [], input.keepResults);
  if (old.length === 0) return { ...base, consequence: "", enabled: false, why: "nothing to clear yet" };
  const freed = Math.max(0, old.reduce((sum, message) => sum + tokensOf(message), 0) - old.length * STUB_TOKENS);
  return { ...base, consequence: `frees ≈ ${formatTokens(freed)} · no model call`, enabled: true };
}

function summariseAction(input: ContextActionsInput): ContextAction {
  const base = { id: "summarise" as const, label: "Summarise earlier turns", key: "s" as const, short: "summarise" };
  const wait = waiting(input);
  if (wait !== null || input.messages === null) return { ...base, consequence: "", enabled: false, why: wait ?? "" };
  const messages = input.messages;
  const turns = messages.flatMap((message, at) => (message.role === "user" ? [at] : []));
  const cut = turns[turns.length - input.keepTurns];
  if (turns.length <= input.keepTurns || cut === undefined) {
    return { ...base, consequence: "", enabled: false, why: "not enough turns yet" };
  }
  const old = messages.slice(0, cut).reduce((sum, message) => sum + tokensOf(message), 0);
  const freed = Math.max(0, old - SUMMARY_TOKENS);
  if (freed === 0) return { ...base, consequence: "", enabled: false, why: "nothing worth summarising yet" };
  return { ...base, consequence: `frees ≈ ${formatTokens(freed)} · one call to ${modelName(input)}`, enabled: true };
}

function growAction(input: ContextActionsInput): ContextAction {
  const name = input.session.name ?? "this model";
  const base = { id: "grow" as const, key: "g" as const };
  const off = (why: string): ContextAction => ({
    ...base,
    label: "Grow the window",
    short: "grow the window",
    consequence: "",
    enabled: false,
    why,
  });
  if (input.source === "user") return off("the window is set by you (/tune)");
  if (input.window === null || input.source !== "planned") return off(`golem has not planned a window for ${name}`);
  const window = input.window;
  const max = listedFor(input)?.ctx ?? null;
  const next = GROW_STEPS.find((step) => step > window && (max === null || step <= max));
  const fit = next === undefined || input.memory === null ? null : memoryFor(next, input.memory, window);
  if (next === undefined || fit?.fit === "too_big") return off(`this Mac cannot hold more for ${name}`);
  const size = formatWindow(next);
  const memory = fit === null ? "" : `${formatExtraGb(fit.extraGb)} memory · `;
  return {
    ...base,
    label: `Grow the window to ${size}`,
    short: `grow to ${size}`,
    consequence: `${memory}reloads the model`,
    enabled: true,
  };
}

const price = (model: ListedModel): number => model.price?.input ?? 0;

function largerAction(input: ContextActionsInput): ContextAction | null {
  const base = { id: "larger" as const, key: "m" as const, label: "Continue on a larger model", short: "larger model" };
  if (input.models === null) return null;
  const own = listedFor(input);
  const window = input.window ?? 0;
  const bigger = input.models
    .filter((model) => model.status === "ready" && model.tools !== false && (model.ctx ?? 0) > window && model !== own)
    .sort((a, b) => price(a) - price(b) || (b.ctx ?? 0) - (a.ctx ?? 0) || a.ref.localeCompare(b.ref));
  const pick = bigger[0];
  if (pick === undefined) return null;
  const paid = pick.tier !== "local" && price(pick) > 0;
  let cost = "free";
  if (paid) {
    const turn = ((input.used ?? 0) * price(pick)) / 1_000_000;
    cost = turn < 0.01 ? "under $0.01 a turn" : `≈ $${turn.toFixed(2)} a turn`;
  }
  const consequence = `${pick.label} · ${formatWindow(pick.ctx ?? 0)} · ${cost}${paid ? " · asks first" : ""}`;
  if (input.route === "auto") {
    return { ...base, consequence, enabled: false, why: "the route is auto: golem steps up by itself" };
  }
  return { ...base, consequence, enabled: true };
}

/**
 * The rows for a context: clear, summarise, grow (a local model only), and a larger model (when a ready
 * one has a bigger window). A row that cannot run says why. Sizes are estimates, so they start with `≈`.
 */
export function contextActions(input: ContextActionsInput): ContextAction[] {
  const local = input.session.provider === "ollama";
  const rows = [clearAction(input), summariseAction(input), ...(local ? [growAction(input)] : []), largerAction(input)];
  const out = rows.filter((row): row is ContextAction => row !== null);
  if (!input.busy) return out;
  return out.map((row) => (row.enabled ? { ...row, enabled: false, why: "wait for the answer to finish" } : row));
}

/** The id of the row to mark `suggested`: the first enabled one, from 80% full. Else null. */
export function suggestedAction(actions: readonly ContextAction[], used: number | null, window: number | null): ContextActionId | null {
  if (contextLevel(used, window) === "ok") return null;
  return actions.find((row) => row.enabled)?.id ?? null;
}

/** The two best rows to offer in a banner: the first two that can run. */
export function bestActions(actions: readonly ContextAction[]): ContextAction[] {
  return actions.filter((row) => row.enabled).slice(0, 2);
}

/** The banner for a real cut, or null: the last call's prompt was cut by the model server. */
export function cutBanner(context: Pick<TraceContext, "prompt_cut"> | null | undefined): string | null {
  const cut = context?.prompt_cut ?? null;
  return cut === "yes" || cut === "likely" ? CUT_BANNER : null;
}

/** `c clear old results · s summarise · g grow to 64K · m larger model`: the rows that can run. Empty when none can. */
export function contextKeyRow(actions: readonly ContextAction[]): string {
  return actions
    .filter((row) => row.enabled)
    .map((row) => `${row.key} ${row.short}`)
    .join(" · ");
}

/** The row a key of the key row runs, or null when the key means none or its row cannot run. */
export function actionForKey(actions: readonly ContextAction[], key: string): ContextAction | null {
  return actions.find((row) => row.key === key && row.enabled) ?? null;
}
