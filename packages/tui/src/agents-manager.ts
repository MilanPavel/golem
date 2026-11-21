import { RpcError, type AgentInfo, type AgentsKeepValues } from "@golem/client";
import { AGENT_GROUPS, AGENT_TEMPLATE, agentRow, agentWarnings, wishLine, wishOptions, type WishModel, type WishOption, type WishSetup } from "@golem/view";

import { readLines, rule, runsText, wrapText } from "./agents-read.ts";
import type { Press } from "./keys.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";

/**
 * `/agents`: every agent type this folder sees, grouped by where it comes from, then one type to read.
 * Enter opens the read view: the path, model, tools, limits, asks and the prompt. `w` there (or in the
 * list) opens the wish choices and Enter asks the daemon to save it (`agents.set_wish`). `c` copies a
 * bundled agent to yours, `e` edits your file in `$EDITOR`, `n` starts a new one from the template and
 * `d` deletes yours; the daemon checks that a text parses before it writes anything (`agents.save`).
 * The list is read with `agents.list` and read again on `agent.registry.changed`, so this state only says
 * where the user is.
 */
type Common = {
  /** One plain line: why the last key was refused, or what it did. It goes away on the next key. */
  notice?: string;
  /** A delete is waiting for `y`. */
  confirm?: boolean;
};

export type AgentsListView = Common & { kind: "list"; selected: number };
export type AgentsDetailView = Common & {
  kind: "detail";
  name: string;
  origin: string;
  /** The wish choices are open, with this one under the cursor. */
  pick?: { selected: number };
  /** The first line of the read view that is on screen. */
  scroll?: number;
};
/** What the daemon found wrong with an edited text. The text is kept so the editor can open on it again. */
export type AgentsProblemsView = {
  kind: "problems";
  text: string;
  /** The file being edited, or undefined for a new agent. */
  name?: string;
  problems: readonly AgentsProblem[];
  /** Where Esc goes: the view the edit started from. */
  back: AgentsListView | AgentsDetailView;
  notice?: string;
};
export type AgentsProblem = { message: string; line?: number | null };

export type AgentsManagerView = AgentsListView | AgentsDetailView | AgentsProblemsView;

export type AgentsManagerState = { open: boolean; view: AgentsManagerView };

/** The types `agents.list` returned for this folder, or why it could not. */
export type AgentList = { agents: readonly AgentInfo[] | null; error: string | null };

export const closedAgentsManager: AgentsManagerState = { open: false, view: { kind: "list", selected: 0 } };

export type AgentsManagerKey =
  | "up"
  | "down"
  | "page-up"
  | "page-down"
  | "top"
  | "bottom"
  | "enter"
  | "back"
  | "wish"
  | "copy"
  | "edit"
  | "new"
  | "delete"
  | "yes";

export type AgentsManagerAction =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "set_wish"; name: string; wish: string }
  | { kind: "copy"; name: string }
  /** Open `text` in `$EDITOR` on a temporary copy, then save it with `agents.save`. `name` is the file it replaces. */
  | { kind: "edit"; text: string; name?: string }
  | { kind: "delete"; name: string };

/** What the wish choices are made of: the setup and the models `model.list` says are there. */
export type AgentsWishContext = { setup: WishSetup; models: readonly WishModel[] };

/** The wish context, and the screen size the read view scrolls in. */
export type AgentsContext = AgentsWishContext & { columns?: number; rows?: number };

export const WISH_OLD = "This golem is too old to change a wish. Update golem.";

/** The same row shape as the MCP manager, so one component draws both. */
export type AgentsManagerLine = McpManagerLine;

/** What an older daemon, which does not know `agents.list`, gets in place of the list. */
export const NO_AGENTS = "this daemon has no agents yet";
export const AGENTS_HINT = "Add one as ~/.golem/agents/<name>.md, or .golem/agents/<name>.md in a project.";
export const LIST_HINT = "↑/↓ move · Enter read · w model · c copy · e edit · n new · d delete · Esc close";
const PICK_HINT = "↑/↓ to choose · Enter to save · Esc to cancel";
const PROBLEMS_HINT = "e edit again · d drop the change · Esc drop the change";
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
  if (press.name === null && !press.ctrl && !press.meta) {
    return LETTER_KEYS[press.input] ?? null;
  }
  switch (press.name) {
    case "up":
    case "down":
    case "page-up":
    case "page-down":
      return press.name;
    case "home":
      return "top";
    case "end":
      return "bottom";
    case "return":
      return "enter";
    case "escape":
      return "back";
    default:
      return null;
  }
}

const LETTER_KEYS: Record<string, AgentsManagerKey | undefined> = {
  w: "wish",
  c: "copy",
  e: "edit",
  n: "new",
  d: "delete",
  y: "yes",
};

/** The types in the order the list shows them: the project's, then yours, then bundled. */
export function orderedAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return ORDER.flatMap((origin) => agents.filter((agent) => agent.origin === origin));
}

const NO_CONTEXT: AgentsContext = { setup: "mixed", models: [] };

export function pressAgentsManager(
  state: AgentsManagerState,
  agents: readonly AgentInfo[],
  key: AgentsManagerKey,
  context: AgentsContext = NO_CONTEXT,
): { state: AgentsManagerState; action: AgentsManagerAction } {
  const none = { kind: "none" } as const;
  const ordered = orderedAgents(agents);
  const view = withoutNotice(state.view);
  const at = (next: AgentsManagerView) => ({ ...state, view: next });
  if (view.kind === "problems") {
    if (key === "edit") {
      return { state: at(view), action: { kind: "edit", text: view.text, ...(view.name === undefined ? {} : { name: view.name }) } };
    }
    return key === "back" || key === "delete" ? { state: at(view.back), action: none } : { state: at(view), action: none };
  }
  const current =
    view.kind === "list"
      ? ordered[clamp(view.selected, ordered.length)]
      : ordered.find((item) => item.name === view.name && item.origin === view.origin);
  if (view.confirm === true) {
    const asked = withoutConfirm(view);
    return key === "yes" && current !== undefined ? { state: at(asked), action: { kind: "delete", name: current.name } } : { state: at(asked), action: none };
  }
  if (key === "new") {
    return { state: at(view), action: { kind: "edit", text: AGENT_TEMPLATE } };
  }
  if (view.kind === "list") {
    const selected = clamp(view.selected, ordered.length);
    if (key === "back") {
      return { state: closedAgentsManager, action: { kind: "close" } };
    }
    if (key === "up" || key === "down") {
      const next = clamp(selected + (key === "up" ? -1 : 1), ordered.length);
      return { state: at({ kind: "list", selected: next }), action: none };
    }
    if (current === undefined) {
      return { state: at(view), action: none };
    }
    if (key === "enter") {
      return { state: at({ kind: "detail", name: current.name, origin: current.origin }), action: none };
    }
    if (key === "wish" && wishEditable(current)) {
      return { state: at(pickView(current, context)), action: none };
    }
    return changeKey(state, view, current, key);
  }
  if (view.pick !== undefined) {
    if (current === undefined) {
      return { state: at({ kind: "detail", name: view.name, origin: view.origin }), action: none };
    }
    const options = wishOptions(current.wish, context.setup, context.models);
    const closed = at({ kind: "detail", name: view.name, origin: view.origin });
    if (key === "back") {
      return { state: closed, action: none };
    }
    if (key === "up" || key === "down") {
      const next = clamp(view.pick.selected + (key === "up" ? -1 : 1), options.length);
      return { state: at({ ...view, pick: { selected: next } }), action: none };
    }
    const chosen = options[clamp(view.pick.selected, options.length)];
    if (key === "enter" && chosen !== undefined) {
      return chosen.value === current.wish ? { state: closed, action: none } : { state: closed, action: { kind: "set_wish", name: current.name, wish: chosen.value } };
    }
    return { state: at(view), action: none };
  }
  if (key === "back") {
    const index = ordered.findIndex((item) => item.name === view.name && item.origin === view.origin);
    return { state: at({ kind: "list", selected: Math.max(0, index) }), action: none };
  }
  if (current === undefined) {
    return { state: at(view), action: none };
  }
  if (key === "wish" && wishEditable(current)) {
    return { state: at(pickView(current, context)), action: none };
  }
  const scroll = scrollKey(view, current, key, context);
  if (scroll !== null) {
    return { state: at(scroll), action: none };
  }
  return changeKey(state, view, current, key);
}

function pickView(agent: AgentInfo, context: AgentsContext): AgentsDetailView {
  const options = wishOptions(agent.wish, context.setup, context.models);
  const current = Math.max(0, options.findIndex((option) => option.value === agent.wish));
  return { kind: "detail", name: agent.name, origin: agent.origin, pick: { selected: current } };
}

/** The read view scrolled by an arrow, page, home or end key; null for any other key. */
function scrollKey(view: AgentsDetailView, agent: AgentInfo, key: AgentsManagerKey, context: AgentsContext): AgentsDetailView | null {
  const room = Math.max(1, (context.rows ?? 24) - 2);
  const total = readLines(agent, { width: context.columns ?? 80, setup: context.setup, models: context.models }).length;
  const last = Math.max(0, total - room);
  const now = Math.min(Math.max(view.scroll ?? 0, 0), last);
  const target =
    key === "up" ? now - 1 : key === "down" ? now + 1 : key === "page-up" ? now - (room - 1) : key === "page-down" ? now + (room - 1) : key === "top" ? 0 : key === "bottom" ? last : null;
  if (target === null) {
    return null;
  }
  const next = Math.min(Math.max(target, 0), last);
  const moved: AgentsDetailView = { ...view };
  if (next === 0) {
    delete moved.scroll;
  } else {
    moved.scroll = next;
  }
  return moved;
}

/** `c`, `e` and `d` on the chosen agent, in the list or in the read view: an action, or one plain line on why not. */
function changeKey(
  state: AgentsManagerState,
  view: AgentsListView | AgentsDetailView,
  agent: AgentInfo,
  key: AgentsManagerKey,
): { state: AgentsManagerState; action: AgentsManagerAction } {
  const refuse = (notice: string) => ({ state: { ...state, view: { ...view, notice } }, action: { kind: "none" } as const });
  if (key === "copy") {
    if (agent.origin === "bundled") {
      return { state: { ...state, view }, action: { kind: "copy", name: agent.name } };
    }
    return refuse(agent.origin === "user" ? `${agent.name} is already yours` : "only a bundled agent is copied: a project agent is a file in the project");
  }
  if (key === "edit") {
    if (agent.origin === "bundled") {
      return refuse("make your own copy first (c)");
    }
    if (agent.origin === "project") {
      return refuse(`a project agent is edited in its own file: ${agent.path ?? ".golem/agents"}`);
    }
    if (agent.text === null || agent.text === undefined) {
      return refuse("this daemon did not send the file, so it cannot be edited here");
    }
    return { state: { ...state, view }, action: { kind: "edit", text: agent.text, name: agent.name } };
  }
  if (key === "delete") {
    if (agent.origin === "bundled") {
      return refuse("a bundled agent cannot be deleted");
    }
    if (agent.origin === "project") {
      return refuse("a project agent is deleted by removing its file");
    }
    return { state: { ...state, view: { ...view, confirm: true } }, action: { kind: "none" } };
  }
  return { state: { ...state, view }, action: { kind: "none" } };
}

function withoutNotice(view: AgentsManagerView): AgentsManagerView {
  if (view.notice === undefined) {
    return view;
  }
  const quiet = { ...view };
  delete quiet.notice;
  return quiet;
}

/** The state with one plain line on the view the user is in (the problems view keeps its problems). */
export function agentsNoticed(state: AgentsManagerState, notice: string): AgentsManagerState {
  return { ...state, view: { ...state.view, notice } };
}

/** The base view of a state: the one the user returns to from a problems view. */
function baseView(view: AgentsManagerView): AgentsListView | AgentsDetailView {
  return view.kind === "problems" ? view.back : view;
}

/**
 * The state after a copy, a save or a delete changed the files, with the new list in hand. From the read view it
 * shows `focus` (the user copy, the saved agent, or what a deleted name means now); from the list it chooses that
 * row. With no focus the list keeps the row it had, in range.
 */
export function agentsFocused(
  state: AgentsManagerState,
  agents: readonly AgentInfo[],
  focus: { name: string; origin: string } | null,
  notice?: string,
): AgentsManagerState {
  const base = baseView(state.view);
  const ordered = orderedAgents(agents);
  const found = focus === null ? -1 : ordered.findIndex((item) => item.name === focus.name && item.origin === focus.origin);
  let view: AgentsListView | AgentsDetailView;
  if (focus !== null && found >= 0 && base.kind === "detail") {
    view = { kind: "detail", name: focus.name, origin: focus.origin };
  } else {
    const was = base.kind === "list" ? base.selected : ordered.findIndex((item) => item.name === base.name && item.origin === base.origin);
    view = { kind: "list", selected: clamp(found >= 0 ? found : was, ordered.length) };
  }
  return { ...state, view: notice === undefined ? view : { ...view, notice } };
}

/** The state when an edited text did not parse: the problems, with the text kept, and Esc back to where the edit began. */
export function agentEditProblems(state: AgentsManagerState, edit: { text: string; name?: string }, problems: readonly AgentsProblem[]): AgentsManagerState {
  const back = withoutConfirm(baseView(withoutNotice(state.view)));
  return { ...state, view: { kind: "problems", text: edit.text, ...(edit.name === undefined ? {} : { name: edit.name }), problems, back } };
}

function withoutConfirm(view: AgentsListView | AgentsDetailView): AgentsListView | AgentsDetailView {
  const asked = { ...view };
  delete asked.confirm;
  return asked;
}

/** `line 3: the model is not a wish`, or the message alone when it is not about one line. */
export function problemText(problem: AgentsProblem): string {
  return problem.line === null || problem.line === undefined ? problem.message : `line ${problem.line}: ${problem.message}`;
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
  const rows = Math.max(0, input.rows);
  const setup = input.setup ?? "mixed";
  const view = input.state.view;
  const agents = input.agents;
  let hint = LIST_HINT;
  const extra: AgentsManagerLine[] = [];
  const noticed = view.notice === undefined ? [] : [{ text: view.notice } satisfies AgentsManagerLine];
  let body: AgentsManagerLine[];
  const room = () => Math.max(0, rows - 2 - extra.length);
  if (view.kind === "problems") {
    extra.push(...noticed);
    body = problemLines(view, width);
    hint = PROBLEMS_HINT;
    return finish(body.slice(0, room()), extra, hint, width, rows);
  }
  if (input.error !== null) {
    body = [{ text: "Agents", bold: true }, { text: "" }, { text: input.error }];
  } else if (agents === null) {
    body = [{ text: "Agents", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  } else {
    const ordered = orderedAgents(agents);
    const chosen = view.kind === "list" ? ordered[clamp(view.selected, ordered.length)] : agents.find((item) => item.name === view.name && item.origin === view.origin);
    extra.push(...noticed);
    if (view.confirm === true && chosen !== undefined) {
      hint = confirmHint(chosen);
    }
    if (view.kind === "list" || chosen === undefined) {
      const selected = view.kind === "list" ? view.selected : 0;
      body = scrollToSelected(listLines(agents, selected, input.cwd, input.home, setup, input.keep ?? null), room());
    } else if (view.pick !== undefined) {
      body = pickLines(chosen, view.pick.selected, setup, input.models ?? [], width);
      hint = PICK_HINT;
    } else {
      const all = readLines(chosen, { width, setup, models: input.models });
      const start = Math.min(Math.max(view.scroll ?? 0, 0), Math.max(0, all.length - room()));
      body = all.slice(start, start + room());
      if (view.confirm !== true) hint = readHint(chosen);
    }
  }
  return finish(body.slice(0, room()), extra, hint, width, rows);
}

function finish(body: AgentsManagerLine[], extra: AgentsManagerLine[], hint: string, width: number, rows: number): AgentsManagerLine[] {
  const lines = [...body, ...extra, { text: "" }, { text: hint, dim: true }];
  return lines.slice(0, rows).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}

/** The footer of the read view: the keys that do something for this agent. */
export function readHint(agent: AgentInfo): string {
  const keys: string[] = [];
  if (wishEditable(agent)) keys.push("w model");
  if (agent.origin === "bundled") keys.push("c make my own copy", "e edit (copy first)");
  if (agent.origin === "user") keys.push("e edit", "d delete");
  keys.push("↑/↓ scroll", "Esc back");
  return keys.join(" · ");
}

function confirmHint(agent: AgentInfo): string {
  const back = (agent.shadowed ?? []).includes("bundled") ? ` The bundled ${agent.name} comes back.` : "";
  return `Delete ${agent.name}?${back} y to delete · any other key to cancel`;
}

function problemLines(view: AgentsProblemsView, width: number): AgentsManagerLine[] {
  const lines: AgentsManagerLine[] = [{ text: "Not saved", bold: true }, { text: "" }, { text: "The file has problems, so nothing was changed:" }];
  for (const problem of view.problems) {
    wrapText(problemText(problem), Math.max(10, width - 2)).forEach((part, index) => {
      lines.push(index === 0 ? { mark: { text: "✘", tone: "bad" }, text: part } : { text: `  ${part}` });
    });
  }
  lines.push({ text: "" }, { text: rule("your text is kept", Math.max(20, Math.min(width, 60))), dim: true });
  lines.push({ text: "e opens it again where you left it; d drops the change.", dim: true });
  return lines;
}

/** `finished helpers: steps kept 7 days · failed, stopped or asking 30 days`; 0 is `for ever`. */
export function keepLine(keep: AgentsKeepValues): string {
  const days = (count: number) => (count === 0 ? "for ever" : `${count} ${count === 1 ? "day" : "days"}`);
  return `finished helpers: steps kept ${days(keep.keep_days)} · failed, stopped or asking ${days(keep.keep_problem_days)}`;
}

/** The wish and what it becomes, as a list row says it: `cheapest → qwen3:14b`; a wish this setup cannot use is `not available here`. */
function listWish(agent: AgentInfo, setup: WishSetup): string {
  if (wishLine(agent.wish, setup, agent.resolves_to).includes("not available here")) {
    return "not available here";
  }
  return agentRow(agent, setup).listLine;
}

function listLines(agents: readonly AgentInfo[], selected: number, cwd: string, home: string, setup: WishSetup, keep: AgentsKeepValues | null): AgentsManagerLine[] {
  const count = `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`;
  const lines: AgentsManagerLine[] = [{ text: "Agents", bold: true }, { text: `${count} · helpers, last 30 days`, dim: true }];
  if (keep !== null) lines.push({ text: keepLine(keep), dim: true });
  if (agents.length === 0) {
    return [...lines, { text: "" }, { text: AGENTS_HINT }];
  }
  const ordered = orderedAgents(agents);
  const marks = ordered.map((agent) => agentRow(agent, setup).mark);
  const wishes = ordered.map((agent) => listWish(agent, setup));
  const nameWidth = Math.max(...ordered.map((agent) => agent.name.length));
  const markWidth = Math.max(...marks.map((mark) => mark.length));
  const wishWidth = Math.max(...wishes.map((wish) => wish.length));
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
        : `${agent.name.padEnd(nameWidth)}  ${(marks[index] ?? "").padEnd(markWidth)}  ${(wishes[index] ?? "").padEnd(wishWidth)}  ${runsText(agent)}`;
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

function statusMark(agent: AgentInfo): { text: string; tone: McpTone } {
  if ((agent.errors ?? []).length > 0) {
    return { text: "✘", tone: "bad" };
  }
  if (agent.origin === "project" && agent.trusted === false) {
    return { text: "!", tone: "wait" };
  }
  return { text: "✔", tone: "ok" };
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

function shortPath(path: string, home: string): string {
  return home.length > 0 && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
