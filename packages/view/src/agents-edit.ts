import type { AgentInfo } from "@golem/client";
import type { AgentOrigin, WishSetup } from "./agents-view.ts";

/** One reason a save was refused: the daemon's words and the line of the text, or null when it has none. */
export interface AgentProblem {
  message: string;
  line?: number | null;
}

/** A problem as one line: `Line 5: there is no tool named "read_files"`, or the message alone. */
export function agentProblemText(problem: AgentProblem): string {
  return problem.line === null || problem.line === undefined ? problem.message : `Line ${problem.line}: ${problem.message}`;
}

/** What an agent offers by where it comes from. */
export interface AgentActions {
  /** "Make my own copy": only a bundled agent. */
  copy: boolean;
  /** "Edit": only your own agent, and only when the daemon sent its file. */
  edit: boolean;
  /** "Delete": only your own agent. */
  remove: boolean;
}

/** A bundled agent can be copied; yours can be edited and deleted; a project agent is read-only here. */
export function agentActions(origin: AgentOrigin, hasText: boolean): AgentActions {
  return { copy: origin === "bundled", edit: origin === "user" && hasText, remove: origin === "user" };
}

/** The key of an agent in the list: a project and a user agent may share a name. */
export function agentKey(agent: { origin: AgentOrigin; name: string }): string {
  return `${agent.origin}/${agent.name}`;
}

/** The head's line for a copy of a bundled agent: `replaces the bundled explorer`. Null when nothing is replaced. */
export function replacesLine(name: string, shadowed: readonly AgentOrigin[]): string | null {
  return shadowed.includes("bundled") ? `replaces the bundled ${name}` : null;
}

/** The question before a delete: a copy says the bundled one comes back. */
export function deleteQuestion(shadowed: readonly AgentOrigin[]): string {
  return shadowed.includes("bundled") ? "Delete your copy and go back to the bundled one?" : "Delete this agent?";
}

/** The note under the file of an agent. */
export function definitionNote(origin: AgentOrigin, shadowed: readonly AgentOrigin[]): string | null {
  if (origin === "bundled") return "This file ships with golem and updates with it. To change the prompt, tools or limits, make your own copy; it wins over this one.";
  if (origin !== "user") return null;
  return shadowed.includes("bundled")
    ? "Your copy replaces the bundled agent of the same name. Delete it to get the bundled one back."
    : "Saved changes apply to the next helper that starts.";
}

/** The key to choose after a save, a copy or a delete: the agent the daemon answered with, or null for the first one. */
export function selectionAfter(agent: { origin: AgentOrigin; name: string } | null | undefined): string | null {
  return agent === null || agent === undefined ? null : agentKey(agent);
}

/** Whether leaving the editor would drop text. */
export function hasUnsavedText(text: string, original: string): boolean {
  return text !== original;
}

/** The limits a person can set: the keys of `agents.set_limits` and `agents.set_default_limits`. */
export type LimitKey = "max_calls" | "working_seconds" | "max_cost" | "max_tokens";

/** One field of the limits form. */
export interface LimitField {
  key: LimitKey;
  label: string;
  /** The word after the box. */
  unit: string;
  /** The label of the matching fact in the Limits block. */
  fact: string;
  /** The key of `limits_from_config`. */
  configKey: string;
}

const LIMIT_FIELDS: Record<LimitKey, LimitField> = {
  max_calls: { key: "max_calls", label: "Tool calls", unit: "calls", fact: "tool calls", configKey: "max_calls" },
  working_seconds: { key: "working_seconds", label: "Working time", unit: "seconds", fact: "time", configKey: "max_seconds" },
  max_cost: { key: "max_cost", label: "Cost", unit: "US dollars", fact: "cost", configKey: "max_cost_usd" },
  max_tokens: { key: "max_tokens", label: "Tokens", unit: "tokens", fact: "tokens", configKey: "max_tokens" },
};

/** The fields in the order to show them: with no local model cost comes first, else calls and time. */
export function limitFields(setup: WishSetup): LimitField[] {
  const order: LimitKey[] = setup === "cloud" ? ["max_cost", "max_calls", "working_seconds", "max_tokens"] : ["max_calls", "working_seconds", "max_cost", "max_tokens"];
  return order.map((key) => LIMIT_FIELDS[key]);
}

/** What a field holds, as typed. An empty text is no limit of your own. */
export type LimitTexts = Record<LimitKey, string>;

type LimitNumber = number | null | undefined;

/** The limits of an agent (resolved) or of `agents.keep`, as the texts of the form. */
export function limitTexts(limits: { max_calls?: LimitNumber; max_seconds?: LimitNumber; working_seconds?: LimitNumber; max_cost_usd?: LimitNumber; max_cost?: LimitNumber; max_tokens?: LimitNumber } | null | undefined): LimitTexts {
  const text = (value: LimitNumber): string => (value == null ? "" : String(value));
  return {
    max_calls: text(limits?.max_calls),
    working_seconds: text(limits?.working_seconds ?? limits?.max_seconds),
    max_cost: text(limits?.max_cost ?? limits?.max_cost_usd),
    max_tokens: text(limits?.max_tokens),
  };
}

/** The labels of the facts (`tool calls`, `time`, `cost`, `tokens`, `answer chars`) that `[agents.<type>]` sets. */
export function configLimitLabels(fromConfig: AgentInfo["limits_from_config"]): string[] {
  const names = new Set(fromConfig ?? []);
  const labels = Object.values(LIMIT_FIELDS)
    .filter((field) => names.has(field.configKey))
    .map((field) => field.fact);
  if (names.has("answer_chars")) labels.push("answer chars");
  return labels;
}

/** The note under a value that `config.toml` sets. */
export const SET_IN_CONFIG = "set in config.toml";

/** Where a type's limits are saved, by origin; a project agent is read-only here. */
export function limitsSavedNote(origin: AgentOrigin): string {
  if (origin === "project") return "A project agent is read-only here. Change its limits in its file.";
  return origin === "user" ? "Saved in the agent's file." : "Saved in config.toml, under this agent.";
}

/** What a cleared field means once it is saved. */
export const LIMITS_CLEAR_HINT = "An empty field means no limit of your own: the next place applies, such as the file's or the default of 15 tool calls.";

/** What the limits for every helper are for. */
export const LIMITS_DEFAULT_HINT = "These apply when a type sets none of its own.";

/** A typed number: the value, null for an empty box, or why it is not allowed. */
export type LimitParse = { ok: true; value: number | null } | { ok: false; message: string };

/** Reads one box. Calls, seconds and tokens are whole numbers of 1 or more; cost is dollars, 0 or more. */
export function parseLimit(key: LimitKey, text: string): LimitParse {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (key === "max_cost") {
    return /^\d+(\.\d+)?$/.test(trimmed) ? { ok: true, value: Number(trimmed) } : { ok: false, message: "Enter an amount in US dollars, 0 or more." };
  }
  return /^\d+$/.test(trimmed) && Number(trimmed) >= 1 ? { ok: true, value: Number(trimmed) } : { ok: false, message: "Enter a whole number, 1 or more." };
}

/** The change to send, or what is wrong with a box. */
export interface LimitsChange {
  change: Partial<Record<LimitKey, number>> & { clear?: LimitKey[] };
  errors: Partial<Record<LimitKey, string>>;
  /** True when nothing differs and nothing is wrong, so nothing needs sending. */
  empty: boolean;
}

const ALL_LIMIT_KEYS = Object.keys(LIMIT_FIELDS) as LimitKey[];

/**
 * The change from what the form had to what it has now. Only a changed box is sent: a number is set, an emptied
 * box goes in `clear`. A box with the same number written another way (`0.50` for `0.5`) is not changed.
 */
export function limitsChange(before: LimitTexts, after: LimitTexts, keys: readonly LimitKey[] = ALL_LIMIT_KEYS): LimitsChange {
  const change: LimitsChange["change"] = {};
  const errors: LimitsChange["errors"] = {};
  const clear: LimitKey[] = [];
  for (const key of keys) {
    const now = parseLimit(key, after[key]);
    if (!now.ok) {
      errors[key] = now.message;
      continue;
    }
    const was = parseLimit(key, before[key]);
    if (was.ok && was.value === now.value) continue;
    if (now.value === null) clear.push(key);
    else change[key] = now.value;
  }
  if (clear.length > 0) change.clear = clear;
  return { change, errors, empty: Object.keys(change).length === 0 && Object.keys(errors).length === 0 };
}
