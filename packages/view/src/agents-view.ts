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
  /** The model the wish picks now, without the `now` word. */
  model: string;
  /** Where that model runs: on this computer, or hosted. Null when the daemon does not say. */
  tier: "local" | "hosted" | null;
  reason: string;
  freshWindow: string;
}

/** The words for `resolves_to`. Null when the daemon does not say (an older daemon) or names no model. */
export function wishNow(resolves: AgentInfo["resolves_to"]): WishNow | null {
  const model = resolves?.model;
  if (resolves === null || resolves === undefined || model === null || model === undefined || model === "") return null;
  return {
    text: `now: ${model}`,
    model,
    tier: resolves.tier === undefined || resolves.tier === null ? null : resolves.tier === "local" ? "local" : "hosted",
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

/**
 * The one usage line: `9 runs in 30 days · 1 stopped early · $0.00`. The stopped part is left out when none
 * stopped (or the daemon cannot count them), the cost part when the daemon cannot say. An agent that cannot be
 * started says `Cannot run yet`, and one never used `Not used yet`.
 */
export function usageLine(agent: AgentInfo): string {
  if (agent.unavailable !== null && agent.unavailable !== undefined) return "Cannot run yet";
  const used = agent.used ?? 0;
  if (used <= 0) return "Not used yet";
  const parts = [`${used} ${used === 1 ? "run" : "runs"} in 30 days`];
  if ((agent.stopped ?? 0) > 0) parts.push(`${agent.stopped} stopped early`);
  if (agent.cost_usd !== null && agent.cost_usd !== undefined) parts.push(`$${agent.cost_usd.toFixed(2)}`);
  return parts.join(" · ");
}

/** The tools of an agent split in two: the ones that only read, and the ones that change things (`changing_tools`). */
export function toolGroups(agent: AgentInfo): { reading: string[]; changing: string[] } {
  const changing = new Set(agent.changing_tools ?? []);
  const tools = agent.tools ?? [];
  return { reading: tools.filter((tool) => !changing.has(tool)), changing: tools.filter((tool) => changing.has(tool)) };
}

/** The small word beside a name for where the agent comes from. */
export const AGENT_MARKS: Record<AgentOrigin, string> = {
  bundled: "bundled",
  user: "yours",
  project: "project",
};

/** The wish as a short word for a list row: `cheapest`, `stronger than the lead`; a model name is shown as it is. */
export function agentWishShort(wish: string): string {
  return Object.hasOwn(WISH_WORDS, wish) ? (WISH_WORDS[wish] ?? wish) : wish;
}

/**
 * The second line of a list row: `cheapest → qwen3:14b`. A wish that already is the model's name, or that the
 * daemon does not resolve (an older daemon), is said alone.
 */
export function agentListLine(wish: string, resolves: AgentInfo["resolves_to"]): string {
  const now = wishNow(resolves);
  const short = agentWishShort(wish);
  if (now === null) return short;
  return short === now.model ? short : `${short} → ${now.model}`;
}

/** Seconds as a person reads them: `45 s`, `5 min`, `90 s` (only whole minutes are said in minutes). */
export function formatSeconds(seconds: number): string {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

/** One fact of the Limits box. */
export interface LimitFact {
  value: string;
  label: string;
}

/**
 * What bounds one helper of this type: tool calls, time and answer length always (`no limit` when the file sets
 * none), tokens and cost only when the file sets them.
 */
export function limitFacts(limits: AgentInfo["limits"]): LimitFact[] {
  const none = "no limit";
  const facts: LimitFact[] = [
    { value: limits?.max_calls == null ? none : String(limits.max_calls), label: "tool calls" },
    { value: limits?.max_seconds == null ? none : formatSeconds(limits.max_seconds), label: "time" },
    { value: limits?.answer_chars == null ? none : String(limits.answer_chars), label: "answer chars" },
  ];
  if (limits?.max_tokens != null) facts.push({ value: String(limits.max_tokens), label: "tokens" });
  if (limits?.max_cost_usd != null) facts.push({ value: `$${limits.max_cost_usd.toFixed(2)}`, label: "cost" });
  return facts;
}

/** Whether the helper may ask you a question, as one line. */
export function asksLine(asks: boolean | undefined): string {
  return asks === true ? "May ask you one short question." : "Never asks you; it works from the brief.";
}

/** One line of the file text: the `---` fences and the keys of the front matter are told apart for tinting. */
export type DefinitionLine = { kind: "fence" | "plain"; text: string } | { kind: "key"; key: string; text: string };

/**
 * The file text split into lines. Between the first two `---` lines, a `key:` at the start of a line is a key;
 * everything else, the whole prompt included, is plain. A key line's `text` is what follows the colon.
 */
export function definitionLines(text: string): DefinitionLine[] {
  let fences = 0;
  return text
    .split("\r").join("")
    .trimEnd()
    .split("\n")
    .map((line): DefinitionLine => {
      if (line === "---" && fences < 2) {
        fences += 1;
        return { kind: "fence", text: line };
      }
      const key = fences === 1 ? /^([A-Za-z][\w-]*):/.exec(line)?.[1] : undefined;
      return key === undefined ? { kind: "plain", text: line } : { kind: "key", key, text: line.slice(key.length + 1) };
    });
}

/** The path line of the Definition tab: a bundled file is read-only. */
export function definitionPath(path: string | null, origin: AgentOrigin): string | null {
  if (path === null) return null;
  return origin === "bundled" ? `${path} · read-only` : path;
}

function toolsNote(agent: AgentInfo): string {
  const { reading, changing } = toolGroups(agent);
  if (reading.length + changing.length === 0) return "";
  return changing.length > 0 ? "Marked tools change things." : "All of these only read.";
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
  /** The word beside the name: bundled, yours or project. */
  mark: string;
  /** The second line of a list row, `cheapest → qwen3:14b`. */
  listLine: string;
  /** Where the model of now runs; null when the daemon does not say. */
  tier: WishNow["tier"];
  /** The Limits box. */
  limits: LimitFact[];
  asksLine: string;
  /** A line under the tool chips: which are marked. Empty with no tools. */
  toolsNote: string;
  /** The path line of the Definition tab, `read-only` for a bundled file; null when the daemon does not say. */
  definitionPath: string | null;
  /** The one usage line, see {@link usageLine}. */
  usage: string;
  /** The file's path, `~` for the home folder; null when the daemon does not say. */
  path: string | null;
  /** The whole file as written; null when the daemon does not say or the folder is not trusted. */
  text: string | null;
  /** The body of the file; null as for `text`. */
  prompt: string | null;
  /** The tools that only read, and the ones that change things. */
  readingTools: string[];
  changingTools: string[];
  /** Why the agent cannot be started now, or null when it can. */
  unavailable: string | null;
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
    usage: usageLine(agent),
    mark: AGENT_MARKS[agent.origin],
    listLine: agentListLine(agent.wish, agent.resolves_to),
    tier: wishNow(agent.resolves_to)?.tier ?? null,
    limits: limitFacts(agent.limits),
    asksLine: asksLine(agent.asks),
    toolsNote: toolsNote(agent),
    definitionPath: definitionPath(agent.path ?? null, agent.origin),
    path: agent.path ?? null,
    text: agent.text ?? null,
    prompt: agent.prompt ?? null,
    readingTools: toolGroups(agent).reading,
    changingTools: toolGroups(agent).changing,
    unavailable: agent.unavailable ?? null,
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
