import type { AgentInfo, ListedModel } from "@golem/client";

import type { McpTone } from "./mcp-servers.ts";

/** What the agents list says about an agent type, as words and data: the TUI lays it out, the page draws it. */
export type AgentOrigin = AgentInfo["origin"];

/** The word for where an agent type comes from. */
export const AGENT_SOURCES: Record<AgentOrigin, string> = {
  bundled: "comes with golem",
  project: "this project",
  user: "you",
};

/** The group titles, by where an agent type comes from. */
export const AGENT_GROUPS: Record<AgentOrigin, string> = {
  project: "This project",
  user: "Yours",
  bundled: "Bundled with golem",
};

const WISHES: Record<string, string> = {
  cheapest: "Cheapest that fits",
  same: "Same as the lead",
  stronger: "Stronger than the lead",
  local: "Always local",
  budget: "Always budget",
  frontier: "Always frontier",
};

/** The model wish in words. A model name is shown as it is. */
export function agentWish(wish: string): string {
  return Object.hasOwn(WISHES, wish) ? (WISHES[wish] ?? wish) : wish;
}

/** The setup the wish words are for: local models only, cloud models only, or both. */
export type WishSetup = "local" | "mixed" | "cloud";

/**
 * The setup from the model list: only local models is `local`, only hosted ones is `cloud`. With both, or with
 * no list yet, it is `mixed`, which says everything.
 */
export function wishSetup(models: readonly Pick<ListedModel, "tier">[] | null | undefined): WishSetup {
  if (models === null || models === undefined || models.length === 0) return "mixed";
  const local = models.filter((model) => model.tier === "local").length;
  if (local === 0) return "cloud";
  return local === models.length ? "local" : "mixed";
}

/** One choice in the wish dropdown. */
export interface WishOption {
  value: string;
  label: string;
  /** What the choice means, in plain words for the setup. */
  hint: string;
}

const WISH_ORDER = ["cheapest", "same", "stronger", "local", "budget", "frontier"] as const;

const WISH_HINTS: Record<WishSetup, Record<(typeof WISH_ORDER)[number], string>> = {
  mixed: {
    cheapest: "the cheapest model that fits the job, a local one first",
    same: "the model the lead runs on",
    stronger: "one step above the lead; golem asks first if that is a paid model you have not used in this chat",
    local: "a model on this computer, always",
    budget: "a cheap hosted model, always",
    frontier: "the strongest hosted models, always",
  },
  local: {
    cheapest: "the smallest local model that fits the job",
    same: "the model the lead runs on",
    stronger: "the same local model with a fresh window, since no larger one is set up",
    local: "a model on this computer, always",
    budget: "",
    frontier: "",
  },
  cloud: {
    cheapest: "the cheapest model that fits the job",
    same: "the model the lead runs on",
    stronger: "one step above the lead",
    local: "",
    budget: "a cheap model, always",
    frontier: "the strongest models, always",
  },
};

/** Whether a wish word may be offered in a setup: local models only hides `budget` and `frontier`, cloud only hides `local`. */
function offered(wish: string, setup: WishSetup): boolean {
  if (setup === "local") return wish !== "budget" && wish !== "frontier";
  if (setup === "cloud") return wish !== "local";
  return true;
}

/** A model the wish dropdown can name: what `model.list` says of it. */
export type WishModel = Pick<ListedModel, "ref" | "label" | "status">;

/**
 * The choices of the wish dropdown for a setup, and the current wish first when it is a model name (or a word
 * this setup does not offer), so the dropdown always shows what is set.
 */
export function wishOptions(current: string, setup: WishSetup, models: readonly WishModel[] = []): WishOption[] {
  const options: WishOption[] = WISH_ORDER.filter((wish) => offered(wish, setup)).map((wish) => ({
    value: wish,
    label: agentWish(wish),
    hint: WISH_HINTS[setup][wish],
  }));
  // Every model that is ready can be named, so "always this model" needs no typing.
  for (const model of models) {
    if (model.status !== "ready" || options.some((option) => option.value === model.ref)) continue;
    options.push({ value: model.ref, label: model.label, hint: "this model, always" });
  }
  if (options.some((option) => option.value === current)) return options;
  const known = Object.hasOwn(WISHES, current);
  return [{ value: current, label: agentWish(current), hint: known ? "" : "this model, always" }, ...options];
}

/** What a wish becomes, as words: `now: qwen3:14b`, why, and whether the helper starts with an empty window. */
export interface WishNow {
  text: string;
  reason: string;
  freshWindow: string;
}

/** The words for `resolves_to`. Null when the daemon does not say (an older daemon) or names no model. */
export function wishNow(resolves: AgentInfo["resolves_to"]): WishNow | null {
  const model = resolves?.model;
  if (resolves === null || resolves === undefined || model === null || model === undefined || model === "") return null;
  return {
    text: `now: ${model}`,
    reason: resolves.reason ?? "",
    freshWindow: resolves.fresh_window === true ? "fresh window" : "",
  };
}

const WISH_WORDS: Record<string, string> = {
  cheapest: "cheapest",
  same: "same as the lead",
  stronger: "stronger than the lead",
  local: "always local",
  budget: "always budget",
  frontier: "always frontier",
};

/**
 * One line for a type's wish, as `wish: cheapest, now qwen3:14b, fresh window`. The setup decides the words: a
 * wish the setup cannot use (a hosted one with local models only, `local` with cloud models only) is said as
 * `not available here`, so no hosted word shows for local models only and no local word for cloud only. Without
 * `resolves_to` (an older daemon) it is the wish alone.
 */
export function wishLine(wish: string, setup: WishSetup, resolves: AgentInfo["resolves_to"]): string {
  const known = Object.hasOwn(WISH_WORDS, wish);
  const words = !known ? wish : offered(wish, setup) ? (WISH_WORDS[wish] ?? wish) : "not available here";
  const now = wishNow(resolves);
  if (now === null) return `wish: ${words}`;
  return `wish: ${words}, ${now.text.replace(":", "")}${now.freshWindow === "" ? "" : `, ${now.freshWindow}`}`;
}

/** How many helpers of this type were started, as `41`, or `—` when none were. */
export function agentUsed(agent: AgentInfo): string {
  return (agent.used ?? 0) > 0 ? String(agent.used) : "—";
}

/** How many helpers of this type ended, as `39`, or `—` when none were started or the daemon cannot count them. */
export function agentFinished(agent: AgentInfo): string {
  if ((agent.used ?? 0) <= 0 || agent.finished === null || agent.finished === undefined) {
    return "—";
  }
  return String(agent.finished);
}

/** The warnings: the file's errors, then a note for a project agent that is not trusted. */
export function agentWarnings(agent: AgentInfo): string[] {
  const warnings = [...(agent.errors ?? [])];
  if (agent.origin === "project" && agent.trusted === false) {
    warnings.push("this folder is not trusted, so this agent is never started");
  }
  return warnings;
}

/** One row of the agents list. */
export interface AgentRow {
  name: string;
  description: string;
  source: AgentOrigin;
  sourceLabel: string;
  wish: string;
  /** The raw wish, as `agents.set_wish` takes it. */
  wishValue: string;
  /** The wish dropdown's choices for the setup. */
  wishOptions: WishOption[];
  /** `now: <model>` with the reason and the fresh window, or null when the daemon does not say. */
  now: WishNow | null;
  /** False for a broken file: it gets no dropdown. */
  editable: boolean;
  used: string;
  finished: string;
  warnings: string[];
  tone: McpTone;
}

/** The row of an agent type. Errors make the tone `bad`; a blocked project agent makes it `wait`. */
export function agentRow(agent: AgentInfo, setup: WishSetup = "mixed", models: readonly WishModel[] = []): AgentRow {
  const broken = (agent.errors ?? []).length > 0;
  const warnings = agentWarnings(agent);
  return {
    name: agent.name,
    description: agent.description.trim().split("\n")[0] ?? "",
    source: agent.origin,
    sourceLabel: AGENT_SOURCES[agent.origin],
    wish: agentWish(agent.wish),
    wishValue: agent.wish,
    wishOptions: wishOptions(agent.wish, setup, models),
    now: wishNow(agent.resolves_to),
    editable: !broken,
    used: agentUsed(agent),
    finished: agentFinished(agent),
    warnings,
    tone: broken ? "bad" : warnings.length > 0 ? "wait" : "ok",
  };
}

/** The agents table: the rows to show, and the names of project agents held back because the folder is not trusted. */
export function agentsTable(agents: readonly AgentInfo[], setup: WishSetup = "mixed", models: readonly WishModel[] = []): { rows: AgentRow[]; untrusted: string[] } {
  const blocked = (agent: AgentInfo): boolean => agent.origin === "project" && agent.trusted === false;
  return {
    rows: agentRows(agents.filter((agent) => !blocked(agent)), setup, models),
    untrusted: agents.filter(blocked).map((agent) => agent.name),
  };
}

/** The rows, in the order the daemon sent them. */
export function agentRows(agents: readonly AgentInfo[], setup: WishSetup = "mixed", models: readonly WishModel[] = []): AgentRow[] {
  return agents.map((agent) => agentRow(agent, setup, models));
}
