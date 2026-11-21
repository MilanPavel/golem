import { RpcError, type AgentInfo, type AgentsKeepValues } from "@golem/client";
import { AGENT_GROUPS, agentWarnings, agentWish, wishLine, wishNow, wishOptions, type WishModel, type WishOption, type WishSetup } from "@golem/view";

import type { Press } from "./keys.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";

/**
 * `/agents`: every agent type this folder sees, grouped by where it comes from,
 * then one type's details. Broken and untrusted types are listed too, with why.
 * The one change is a type's wish: `w` in the detail opens the choices and Enter asks
 * the daemon to save it (`agents.set_wish`). No model is asked. The list is read with
 * `agents.list` and read again on `agent.registry.changed`, so this state only
 * says where the user is.
 */
export type AgentsManagerView =
  | { kind: "list"; selected: number }
  | {
      kind: "detail";
      name: string;
      origin: string;
      /** The wish choices are open, with this one under the cursor. */
      pick?: { selected: number };
      /** One plain line: why the last save was refused. */
      notice?: string;
    };

export type AgentsManagerState = { open: boolean; view: AgentsManagerView };

/** The types `agents.list` returned for this folder, or why it could not. */
export type AgentList = { agents: readonly AgentInfo[] | null; error: string | null };

export const closedAgentsManager: AgentsManagerState = { open: false, view: { kind: "list", selected: 0 } };

export type AgentsManagerKey = "up" | "down" | "enter" | "back" | "wish";

export type AgentsManagerAction = { kind: "none" } | { kind: "close" } | { kind: "set_wish"; name: string; wish: string };

/** What the wish choices are made of: the setup and the models `model.list` says are there. */
export type AgentsWishContext = { setup: WishSetup; models: readonly WishModel[] };

export const WISH_OLD = "This golem is too old to change a wish. Update golem.";

/** The same row shape as the MCP manager, so one component draws both. */
export type AgentsManagerLine = McpManagerLine;

/** What an older daemon, which does not know `agents.list`, gets in place of the list. */
export const NO_AGENTS = "this daemon has no agents yet";
export const AGENTS_HINT = "Add one as ~/.golem/agents/<name>.md, or .golem/agents/<name>.md in a project.";
const LIST_HINT = "↑/↓ to navigate · Enter to open · Esc to close";
const DETAIL_HINT = "Esc to go back";
const DETAIL_WISH_HINT = "w to change the wish · Esc to go back";
const PICK_HINT = "↑/↓ to choose · Enter to save · Esc to cancel";
const METHOD_NOT_FOUND = -32601;
const ORDER = ["project", "user", "bundled"] as const;

export function openAgentsManager(): AgentsManagerState {
  return { open: true, view: { kind: "list", selected: 0 } };
}

/** The list after `agents.list` failed: one plain line for a daemon that lacks the method. */
export function agentListFailed(error: unknown): AgentList {
  if (error instanceof RpcError && error.code === METHOD_NOT_FOUND) {
    return { agents: null, error: NO_AGENTS };
  }
  return { agents: null, error: error instanceof Error && error.message.length > 0 ? error.message : "request failed" };
}

/** Whether this type's wish can be changed here: not a broken type, not an untrusted project one. */
export function wishEditable(agent: AgentInfo): boolean {
  return (agent.errors ?? []).length === 0 && !(agent.origin === "project" && agent.trusted === false);
}

/** The state after a refused save: one plain line, the old value stays. */
export function agentWishFailed(state: AgentsManagerState, error: unknown): AgentsManagerState {
  const view = state.view;
  if (view.kind !== "detail") {
    return state;
  }
  const text =
    error instanceof RpcError && error.code === METHOD_NOT_FOUND
      ? WISH_OLD
      : error instanceof Error && error.message.length > 0
        ? error.message
        : "Could not change the wish.";
  return { ...state, view: { kind: "detail", name: view.name, origin: view.origin, notice: text } };
}

/** The list with the type the daemon answered with in place of the one it had. */
export function agentsWithSaved(agents: readonly AgentInfo[], saved: AgentInfo): AgentInfo[] {
  return agents.map((agent) => (agent.name === saved.name && agent.origin === saved.origin ? saved : agent));
}

export function agentsManagerKeyOf(press: Press): AgentsManagerKey | null {
  if (press.name === null && press.input === "w" && !press.ctrl && !press.meta) {
    return "wish";
  }
  if (press.name === "up" || press.name === "down") {
    return press.name;
  }
  if (press.name === "return") {
    return "enter";
  }
  return press.name === "escape" ? "back" : null;
}

/** The types in the order the list shows them: the project's, then yours, then bundled. */
export function orderedAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return ORDER.flatMap((origin) => agents.filter((agent) => agent.origin === origin));
}

export function pressAgentsManager(
  state: AgentsManagerState,
  agents: readonly AgentInfo[],
  key: AgentsManagerKey,
  wish: AgentsWishContext = { setup: "mixed", models: [] },
): { state: AgentsManagerState; action: AgentsManagerAction } {
  const none = { kind: "none" } as const;
  const ordered = orderedAgents(agents);
  const view = state.view;
  if (view.kind === "list") {
    const selected = clamp(view.selected, ordered.length);
    if (key === "back") {
      return { state: closedAgentsManager, action: { kind: "close" } };
    }
    if (key === "up" || key === "down") {
      const next = clamp(selected + (key === "up" ? -1 : 1), ordered.length);
      return { state: { ...state, view: { kind: "list", selected: next } }, action: none };
    }
    const agent = ordered[selected];
    if (key === "enter" && agent !== undefined) {
      return { state: { ...state, view: { kind: "detail", name: agent.name, origin: agent.origin } }, action: none };
    }
    return { state, action: none };
  }
  const agent = ordered.find((item) => item.name === view.name && item.origin === view.origin);
  if (view.pick !== undefined) {
    if (agent === undefined) {
      return { state: { ...state, view: { kind: "detail", name: view.name, origin: view.origin } }, action: none };
    }
    const options = wishOptions(agent.wish, wish.setup, wish.models);
    if (key === "back") {
      return { state: { ...state, view: { kind: "detail", name: view.name, origin: view.origin } }, action: none };
    }
    if (key === "up" || key === "down") {
      const next = clamp(view.pick.selected + (key === "up" ? -1 : 1), options.length);
      return { state: { ...state, view: { ...view, pick: { selected: next } } }, action: none };
    }
    const chosen = options[clamp(view.pick.selected, options.length)];
    if (key === "enter" && chosen !== undefined) {
      const closed = { ...state, view: { kind: "detail" as const, name: view.name, origin: view.origin } };
      return chosen.value === agent.wish ? { state: closed, action: none } : { state: closed, action: { kind: "set_wish", name: agent.name, wish: chosen.value } };
    }
    return { state, action: none };
  }
  if (key === "wish" && agent !== undefined && wishEditable(agent)) {
    const options = wishOptions(agent.wish, wish.setup, wish.models);
    const current = Math.max(0, options.findIndex((option) => option.value === agent.wish));
    return { state: { ...state, view: { kind: "detail", name: view.name, origin: view.origin, pick: { selected: current } } }, action: none };
  }
  if (key === "back") {
    const index = ordered.findIndex((item) => item.name === view.name && item.origin === view.origin);
    return { state: { ...state, view: { kind: "list", selected: Math.max(0, index) } }, action: none };
  }
  return { state, action: none };
}

export function layoutAgentsManager(input: {
  state: AgentsManagerState;
  agents: readonly AgentInfo[] | null;
  error: string | null;
  cwd: string;
  home: string;
  columns: number;
  rows: number;
  /** The setup the wish words are for; `mixed` when the model list is not known. */
  setup?: WishSetup;
  /** The models the wish choices may name. */
  models?: readonly WishModel[];
  /** How long a finished helper's steps are kept, or null while unknown. Read only here. */
  keep?: AgentsKeepValues | null;
}): AgentsManagerLine[] {
  const width = Math.max(1, input.columns);
  const room = Math.max(0, input.rows - 2);
  let body: AgentsManagerLine[];
  let hint = LIST_HINT;
  const setup = input.setup ?? "mixed";
  const view = input.state.view;
  if (input.error !== null) {
    body = [{ text: "Agents", bold: true }, { text: "" }, { text: input.error }];
  } else if (input.agents === null) {
    body = [{ text: "Agents", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  } else if (view.kind === "list") {
    body = scrollToSelected(listLines(input.agents, view.selected, input.cwd, input.home, setup, input.keep ?? null), room);
  } else {
    const agent = input.agents.find((item) => item.name === view.name && item.origin === view.origin);
    if (agent === undefined) {
      body = scrollToSelected(listLines(input.agents, 0, input.cwd, input.home, setup, input.keep ?? null), room);
    } else {
      if (view.pick !== undefined) {
        body = pickLines(agent, view.pick.selected, setup, input.models ?? [], width);
        hint = PICK_HINT;
      } else {
        body = detailLines(agent, width, setup);
        if (view.notice !== undefined) {
          body.push({ text: "" }, { mark: { text: "✘", tone: "bad" }, text: view.notice });
        }
        hint = wishEditable(agent) ? DETAIL_WISH_HINT : DETAIL_HINT;
      }
    }
  }
  const lines = [...body.slice(0, room), { text: "" }, { text: hint, dim: true }];
  return lines.slice(0, Math.max(0, input.rows)).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}

/** `finished helpers: steps kept 7 days · failed, stopped or asking 30 days`; 0 is `for ever`. */
export function keepLine(keep: AgentsKeepValues): string {
  const days = (count: number) => (count === 0 ? "for ever" : `${count} ${count === 1 ? "day" : "days"}`);
  return `finished helpers: steps kept ${days(keep.keep_days)} · failed, stopped or asking ${days(keep.keep_problem_days)}`;
}

/** `used 41 · finished 39`, or `not used yet`. `finished` is a number of helpers. */
export function agentCounts(agent: AgentInfo): string {
  const used = agent.used ?? 0;
  if (used <= 0) {
    return "not used yet";
  }
  const finished = agent.finished;
  return finished === null || finished === undefined ? `used ${used}` : `used ${used} · finished ${finished}`;
}

function listLines(agents: readonly AgentInfo[], selected: number, cwd: string, home: string, setup: WishSetup, keep: AgentsKeepValues | null): AgentsManagerLine[] {
  const count = `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`;
  const lines: AgentsManagerLine[] = [{ text: "Agents", bold: true }, { text: `${count} · helpers, last 30 days`, dim: true }];
  if (keep !== null) lines.push({ text: keepLine(keep), dim: true });
  if (agents.length === 0) {
    return [...lines, { text: "" }, { text: AGENTS_HINT }];
  }
  const ordered = orderedAgents(agents);
  const nameWidth = Math.max(...ordered.map((agent) => agent.name.length));
  const countWidth = Math.max(...ordered.map((agent) => agentCounts(agent).length));
  const chosen = clamp(selected, ordered.length);
  let group: string | undefined;
  ordered.forEach((agent, index) => {
    if (agent.origin !== group) {
      group = agent.origin;
      const where = agent.origin === "project" ? ` (${shortPath(cwd, home)})` : "";
      lines.push({ text: "" }, { text: `  ${AGENT_GROUPS[agent.origin]}${where}`, bold: true });
    }
    const warnings = agentWarnings(agent);
    const text =
      warnings.length > 0
        ? `${agent.name.padEnd(nameWidth)}  ${warnings[0] ?? ""}`
        : `${agent.name.padEnd(nameWidth)}  ${agentCounts(agent).padEnd(countWidth)}  ${wishLine(agent.wish, setup, agent.resolves_to)} · ${firstLine(agent.description)}`;
    lines.push({
      prefix: index === chosen ? "❯ " : "  ",
      mark: statusMark(agent),
      text,
      selected: index === chosen,
      dim: (agent.errors ?? []).length > 0 || agent.trusted === false,
    });
  });
  return lines;
}

function detailLines(agent: AgentInfo, width: number, setup: WishSetup): AgentsManagerLine[] {
  const label = (key: string) => `${key}:`.padEnd(15);
  const indent = " ".repeat(15);
  const lines: AgentsManagerLine[] = [
    { text: `${agent.name} agent`, bold: true },
    { text: "" },
    { prefix: label("Status"), mark: statusMark(agent), text: statusWord(agent) },
    { text: `${label("From")}${AGENT_GROUPS[agent.origin]}` },
  ];
  const wrapped = (key: string, text: string) =>
    wrap(text, Math.max(10, width - 15)).forEach((part, index) => {
      lines.push({ text: `${index === 0 ? label(key) : indent}${part}` });
    });
  if (agent.description.trim().length > 0) {
    wrapped("Description", agent.description);
  }
  lines.push({ text: `${label("Model")}${agentWish(agent.wish)}` });
  lines.push({ text: `${label("Wish")}${wishLine(agent.wish, setup, agent.resolves_to).replace(/^wish: /, "")}` });
  const why = wishNow(agent.resolves_to)?.reason ?? "";
  if (why.length > 0) {
    wrapped("Why", why);
  }
  wrapped("Tools", (agent.tools ?? []).length > 0 ? (agent.tools ?? []).join(", ") : "none");
  lines.push({ text: `${label("May ask you")}${agent.asks === true ? "yes" : "no"}` });
  const limits = limitWords(agent);
  wrapped("Limits", limits.length > 0 ? limits.join(", ") : "none set");
  lines.push({ text: `${label("Helpers")}${agentCounts(agent)}` });
  if ((agent.shadowed ?? []).length > 0) {
    wrapped("Hides", (agent.shadowed ?? []).map((origin) => AGENT_GROUPS[origin]).join(", "));
  }
  const issues = agentWarnings(agent);
  if (issues.length > 0) {
    const tone = (agent.errors ?? []).length > 0 ? "bad" : "wait";
    lines.push({ text: "" }, { text: (agent.errors ?? []).length > 0 ? "Errors" : "Warnings", bold: true });
    for (const item of issues) {
      wrap(item, Math.max(10, width - 2)).forEach((part, index) => {
        lines.push(index === 0 ? { mark: { text: tone === "bad" ? "✘" : "!", tone }, text: part } : { text: `  ${part}` });
      });
    }
  }
  return lines;
}

/** The choices: wishes, tiers the setup has, ready models, with the current one marked. */
function pickLines(agent: AgentInfo, selected: number, setup: WishSetup, models: readonly WishModel[], width: number): AgentsManagerLine[] {
  const options: WishOption[] = wishOptions(agent.wish, setup, models);
  const chosen = clamp(selected, options.length);
  const labelWidth = Math.max(...options.map((option) => option.label.length));
  const lines: AgentsManagerLine[] = [{ text: `Wish for ${agent.name}`, bold: true }, { text: "" }];
  options.forEach((option, index) => {
    const now = option.value === agent.wish ? "✔ " : "  ";
    const hint = option.hint.length > 0 ? `  ${option.hint}` : "";
    lines.push({ prefix: index === chosen ? "❯ " : "  ", text: fit(`${now}${option.label.padEnd(labelWidth)}${hint}`, Math.max(10, width - 2)), selected: index === chosen });
  });
  return lines;
}

function limitWords(agent: AgentInfo): string[] {
  const limits = agent.limits ?? {};
  const words: string[] = [];
  if (limits.max_seconds != null) {
    words.push(`${limits.max_seconds} s of work`);
  }
  if (limits.max_calls != null) {
    words.push(`${limits.max_calls} tool calls`);
  }
  if (limits.max_tokens != null) {
    words.push(`${limits.max_tokens} tokens`);
  }
  if (limits.max_cost_usd != null) {
    words.push(`$${limits.max_cost_usd}`);
  }
  if (limits.answer_chars != null) {
    words.push(`answer cut at ${limits.answer_chars} characters`);
  }
  return words;
}

function statusMark(agent: AgentInfo): { text: string; tone: McpTone } {
  if ((agent.errors ?? []).length > 0) {
    return { text: "✘", tone: "bad" };
  }
  if (agent.origin === "project" && agent.trusted === false) {
    return { text: "!", tone: "wait" };
  }
  return { text: "✔", tone: "ok" };
}

function statusWord(agent: AgentInfo): string {
  if ((agent.errors ?? []).length > 0) {
    return "broken: never started";
  }
  if (agent.origin === "project" && agent.trusted === false) {
    return "this folder is not trusted: never started";
  }
  return "ready";
}

/** Keep the selected line on screen, with the title lines above it when they fit. */
function scrollToSelected(lines: AgentsManagerLine[], room: number): AgentsManagerLine[] {
  if (lines.length <= room) {
    return lines;
  }
  const selected = Math.max(0, lines.findIndex((line) => line.selected === true));
  const start = Math.min(Math.max(0, selected - room + 1), lines.length - room);
  return lines.slice(start, start + room);
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((part) => part.length > 0)) {
    if (current.length > 0 && current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current.length > 0 ? `${current} ${word}` : word;
    }
  }
  return current.length > 0 ? [...lines, current] : lines;
}

function shortPath(path: string, home: string): string {
  return home.length > 0 && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
