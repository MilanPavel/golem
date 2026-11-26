import type { RoutineInfo, RoutineIssue, RoutineRunSummary } from "@golem/client";
import {
  fileName,
  formatDuration,
  lastResultText,
  nextRunText,
  routineHeadline,
  routineRowLine,
  routineState,
  runWhenText,
} from "@golem/view";

import type { Press } from "./keys.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";

/**
 * `/routines`: every routine golem knows, yours first and then each project's, then one routine's
 * facts, its last runs, and what you can do with it. The words come from `@golem/view`, so the web
 * and the terminal say the same thing. The routines are the app's list, so this state only says
 * where the user is.
 */
export type RoutinesManagerView =
  | { kind: "list"; selected: number }
  /** `key` is `routineKey` of the routine in view. */
  | { kind: "detail"; key: string; selected: number };

export type RoutinesManagerState = { open: boolean; view: RoutinesManagerView };

/** The routines `routine.list` returned, the files that did not parse, or why it could not. */
export type RoutineList = {
  routines: readonly RoutineInfo[] | null;
  issues: readonly RoutineIssue[];
  error: string | null;
};

export const closedRoutinesManager: RoutinesManagerState = { open: false, view: { kind: "list", selected: 0 } };

export type RoutinesManagerKey = "up" | "down" | "enter" | "back" | "run" | "pause" | "edit" | number;

export type RoutinesManagerAction =
  | { kind: "none" }
  | { kind: "close" }
  /** Fire it now. `folder` is the project of a project routine. */
  | { kind: "run"; name: string; folder: string | null }
  /** Write `enabled` in `config.toml`: `paused` turns it off. */
  | { kind: "set-paused"; name: string; paused: boolean }
  /** Open `path` in `$EDITOR` at this routine's `[[routine]]`, then read the routines again. */
  | { kind: "edit"; path: string; name: string }
  /** Go to the chat of a run. */
  | { kind: "open-run"; sessionId: string }
  /** The detail was opened: read the routine's last runs. */
  | { kind: "load-runs"; name: string; folder: string | null }
  | { kind: "notice"; text: string };

/** The same row shape as the MCP manager, so one component draws both. */
export type RoutinesManagerLine = McpManagerLine;

/** One numbered action in a routine's detail. */
export type RoutineChoice = { label: string; action: RoutinesManagerAction };

const LIST_HINT = "↑/↓ to navigate · Enter to open · r run now · p pause · e edit · Esc to close";
const DETAIL_HINT = "↑/↓ to navigate · Enter to select · Esc to go back";
const NO_ROUTINES = "Add one with golem routines edit, or make one in the web page.";
const LAST_RUNS = 3;

export function openRoutinesManager(): RoutinesManagerState {
  return { open: true, view: { kind: "list", selected: 0 } };
}

/** What names a routine: its name, and the project it is in (a project's routine may share a name with yours). */
export function routineKey(routine: RoutineInfo): string {
  return `${routine.folder ?? ""}\u0000${routine.config.name}`;
}

/** Yours first, then each project's, each group in the daemon's order. */
export function orderedRoutines(routines: readonly RoutineInfo[]): RoutineInfo[] {
  return [...routines.filter((item) => item.source === "user"), ...routines.filter((item) => item.source !== "user")];
}

export function routinesManagerKeyOf(press: Press): RoutinesManagerKey | null {
  if (press.name === "up" || press.name === "down") {
    return press.name;
  }
  if (press.name === "return") {
    return "enter";
  }
  if (press.name === "escape") {
    return "back";
  }
  if (press.ctrl || press.meta) {
    return null;
  }
  if (/^[1-9]$/.test(press.input)) {
    return Number(press.input);
  }
  if (press.input === "r") {
    return "run";
  }
  if (press.input === "p") {
    return "pause";
  }
  return press.input === "e" ? "edit" : null;
}

/** The actions in a routine's detail, in order. The number keys pick them. */
export function routineChoices(routine: RoutineInfo): RoutineChoice[] {
  const name = routine.config.name;
  const off = routine.config.enabled === false;
  const own = routine.source === "user";
  const session = routine.last?.session_id ?? null;
  return [
    { label: "Run now", action: { kind: "run", name, folder: routine.folder ?? null } },
    {
      label: off ? "Resume" : "Pause",
      action: own
        ? { kind: "set-paused", name, paused: !off }
        : { kind: "notice", text: `${name} is in its project: set enabled in the project's config.toml` },
    },
    { label: "Edit in $EDITOR", action: { kind: "edit", path: routine.path, name } },
    {
      label: "Open the last run",
      action:
        session === null
          ? { kind: "notice", text: `${name} has no run to open yet` }
          : { kind: "open-run", sessionId: session },
    },
  ];
}

/**
 * The 1-based line of the `[[routine]]` whose `name` this is, or the first `[[routine]]` when none
 * has it, or null when the file has none.
 */
export function routineLineOf(text: string, name: string): number | null {
  const named = new RegExp(`^\\s*name\\s*=\\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\s*(#.*)?$`);
  let first: number | null = null;
  let start: number | null = null;
  let found: number | null = null;
  text.split("\n").forEach((line, index) => {
    if (/^\s*\[\[\s*routine\s*\]\]/.test(line)) {
      start = index + 1;
      first ??= start;
    } else if (/^\s*\[/.test(line)) {
      start = null;
    } else if (start !== null && found === null && named.test(line)) {
      found = start;
    }
  });
  return found ?? first;
}

export function pressRoutinesManager(
  state: RoutinesManagerState,
  routines: readonly RoutineInfo[],
  key: RoutinesManagerKey,
): { state: RoutinesManagerState; action: RoutinesManagerAction } {
  const none = { kind: "none" } as const;
  const items = orderedRoutines(routines);
  const view = state.view;
  if (view.kind === "list") {
    const selected = clamp(view.selected, items.length);
    if (key === "back") {
      return { state: closedRoutinesManager, action: { kind: "close" } };
    }
    if (key === "up" || key === "down") {
      const next = clamp(selected + (key === "up" ? -1 : 1), items.length);
      return { state: { ...state, view: { kind: "list", selected: next } }, action: none };
    }
    const routine = items[selected];
    if (routine === undefined) {
      return { state, action: none };
    }
    if (key === "enter") {
      return {
        state: { ...state, view: { kind: "detail", key: routineKey(routine), selected: 0 } },
        action: { kind: "load-runs", name: routine.config.name, folder: routine.folder ?? null },
      };
    }
    return { state, action: choiceFor(routine, key) };
  }
  const index = items.findIndex((item) => routineKey(item) === view.key);
  const routine = items[index];
  if (key === "back" || routine === undefined) {
    return { state: { ...state, view: { kind: "list", selected: Math.max(0, index) } }, action: none };
  }
  const choices = routineChoices(routine);
  if (key === "up" || key === "down") {
    const selected = clamp(view.selected + (key === "up" ? -1 : 1), choices.length);
    return { state: { ...state, view: { ...view, selected } }, action: none };
  }
  if (key === "enter") {
    return { state, action: choices[clamp(view.selected, choices.length)]?.action ?? none };
  }
  return { state, action: choiceFor(routine, key) };
}

/** What the number keys and the letters do to one routine. */
function choiceFor(routine: RoutineInfo, key: RoutinesManagerKey): RoutinesManagerAction {
  const choices = routineChoices(routine);
  const picked =
    typeof key === "number"
      ? choices[key - 1]
      : key === "run"
        ? choices[0]
        : key === "pause"
          ? choices[1]
          : key === "edit"
            ? choices[2]
            : undefined;
  return picked?.action ?? { kind: "none" };
}

export function layoutRoutinesManager(input: {
  state: RoutinesManagerState;
  list: RoutineList;
  /** The last runs of the routine in the detail, newest first, or null while they are read. */
  runs: readonly RoutineRunSummary[] | null;
  now: number;
  home: string;
  columns: number;
  rows: number;
}): RoutinesManagerLine[] {
  const width = Math.max(1, input.columns);
  const room = Math.max(0, input.rows - 2);
  const view = input.state.view;
  let body: RoutinesManagerLine[];
  let hint = LIST_HINT;
  if (input.list.error !== null) {
    body = [{ text: "Routines", bold: true }, { text: "" }, { text: input.list.error }];
  } else if (input.list.routines === null) {
    body = [{ text: "Routines", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  } else {
    const items = orderedRoutines(input.list.routines);
    const routine = view.kind === "detail" ? items.find((item) => routineKey(item) === view.key) : undefined;
    if (view.kind === "detail" && routine !== undefined) {
      body = scrollToSelected(detailLines(routine, view.selected, input.runs, input.now, input.home), room);
      hint = DETAIL_HINT;
    } else {
      const selected = view.kind === "list" ? view.selected : 0;
      body = scrollToSelected(listLines(items, input.list.issues, selected, input.now), room);
    }
  }
  const lines = [...body.slice(0, room), { text: "" }, { text: hint, dim: true }];
  return lines.slice(0, Math.max(0, input.rows)).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}

/** ✔ last ok, ✘ last failed, ! waiting, ● running, ○ paused or never ran. */
export function routineMark(routine: RoutineInfo): { text: string; tone: McpTone } {
  const state = routineState(routine);
  if (state === "waiting") return { text: "!", tone: "wait" };
  if (state === "failed") return { text: "✘", tone: "bad" };
  if (state === "running") return { text: "●", tone: "ok" };
  if (state === "idle" && routine.last?.status === "succeeded") return { text: "✔", tone: "ok" };
  return { text: "○", tone: "off" };
}

/** `4 routines · next: morning-brief in 14 h`: what is next, so a quiet list still answers "will it run?". */
function countLine(items: readonly RoutineInfo[], now: number): string {
  const count = `${items.length} ${items.length === 1 ? "routine" : "routines"}`;
  let soonest: RoutineInfo | null = null;
  let soonestAt = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const at = item.next_at === null || item.next_at === undefined ? Number.NaN : Date.parse(item.next_at);
    if (!Number.isNaN(at) && routineState(item) !== "off" && at < soonestAt) {
      soonest = item;
      soonestAt = at;
    }
  }
  const away = soonest === null ? "" : nextRunText(soonest.next_at, now).replace(/^next /, "");
  return soonest === null || away === "" ? count : `${count} · next: ${soonest.config.name} ${away}`;
}

function listLines(
  items: readonly RoutineInfo[],
  issues: readonly RoutineIssue[],
  selected: number,
  now: number,
): RoutinesManagerLine[] {
  const lines: RoutinesManagerLine[] = [{ text: "Routines", bold: true }];
  if (items.length === 0) {
    lines.push({ text: "no routines", dim: true }, { text: "" }, { text: NO_ROUTINES });
  } else {
    lines.push({ text: countLine(items, now), dim: true });
    const nameWidth = Math.max(...items.map((item) => item.config.name.length));
    const chosen = clamp(selected, items.length);
    items.forEach((routine, index) => {
      lines.push({
        prefix: index === chosen ? "❯ " : "  ",
        mark: routineMark(routine),
        text: `${routine.config.name.padEnd(nameWidth)}  ${routineRowLine(routine, now)}`,
        selected: index === chosen,
        dim: routineState(routine) === "off",
      });
    });
  }
  for (const issue of issues) {
    const at = issue.line === null || issue.line === undefined ? "" : `:${issue.line}`;
    lines.push({ text: "" }, { text: `${issue.file}${at}: ${issue.message}`, mark: { text: "✘", tone: "bad" } });
  }
  return lines;
}

const STATUS_WORDS = {
  off: "paused",
  running: "running",
  waiting: "needs you",
  failed: "last run failed",
  idle: "scheduled",
} as const;

function detailLines(
  routine: RoutineInfo,
  selected: number,
  runs: readonly RoutineRunSummary[] | null,
  now: number,
  home: string,
): RoutinesManagerLine[] {
  const label = (key: string) => `${key}:`.padEnd(10);
  const config = routine.config;
  const state = routineState(routine);
  const status = routine.blocked === true ? "untrusted folder: it never runs" : state === "idle" && config.on ? "watching" : STATUS_WORDS[state];
  const lines: RoutinesManagerLine[] = [
    { text: `${config.name} routine`, bold: true },
    { text: "" },
    { prefix: label("Status"), mark: routineMark(routine), text: status },
    { text: `${label("Trigger")}${routineHeadline(routine, now)}` },
    config.workflow
      ? { text: `${label("Workflow")}${config.workflow}${workflowInputs(config.inputs)}` }
      : { text: `${label("Prompt")}${firstLine(config.prompt ?? "")}` },
  ];
  if (config.folder) lines.push({ text: `${label("Folder")}${shortPath(config.folder, home)}` });
  if (config.model) lines.push({ text: `${label("Model")}${config.model}` });
  if ((config.mcp ?? []).length > 0) lines.push({ text: `${label("MCP")}${(config.mcp ?? []).join(", ")}` });
  lines.push({ text: `${label("Config")}${shortPath(routine.path, home)} · [[routine]] ${config.name}` });
  lines.push({ text: "" }, { text: "Last runs:", bold: true });
  if (runs === null) {
    lines.push({ text: "  asking the daemon…", dim: true });
  } else if (runs.length === 0) {
    lines.push({ text: "  no runs yet", dim: true });
  }
  for (const run of (runs ?? []).slice(0, LAST_RUNS)) {
    lines.push({ prefix: "  ", text: runLine(run, now), mark: runMark(run) });
  }
  const choices = routineChoices(routine);
  const chosen = clamp(selected, choices.length);
  lines.push({ text: "" });
  choices.forEach((choice, index) => {
    lines.push({ text: `${index === chosen ? "❯ " : "  "}${index + 1}. ${choice.label}`, selected: index === chosen });
  });
  return lines;
}

function runMark(run: RoutineRunSummary): { text: string; tone: McpTone } {
  if (run.status === "succeeded") return { text: "✔", tone: "ok" };
  if (run.status === "failed") return { text: "✘", tone: "bad" };
  if (run.status === "waiting") return { text: "!", tone: "wait" };
  if (run.status === "running" || run.status === "queued") return { text: "●", tone: "ok" };
  return { text: "○", tone: "off" };
}

/** `Today 08:30  2m 14.9s  5 PRs, 3 Linear issues`: when, how long, and how it went. A run for a file says which one, after the time. */
function runLine(run: RoutineRunSummary, now: number): string {
  const started = run.started_at ?? run.due_at ?? null;
  const began = started === null ? Number.NaN : Date.parse(started);
  const ended = run.ended_at === null || run.ended_at === undefined ? Number.NaN : Date.parse(run.ended_at);
  const took = Number.isNaN(began) || Number.isNaN(ended) ? "" : formatDuration(ended - began);
  const file = run.watch_path === null || run.watch_path === undefined ? "" : fileName(run.watch_path);
  return [runWhenText(started, now), file, took, lastResultText(run)].filter((part) => part !== "").join("  ");
}

/** Keep the selected line on screen, with the title lines above it when they fit. */
function scrollToSelected(lines: RoutinesManagerLine[], room: number): RoutinesManagerLine[] {
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

function workflowInputs(inputs: Readonly<Record<string, string | number | boolean>> | undefined): string {
  const given = Object.entries(inputs ?? {});
  return given.length === 0 ? "" : ` (${given.map(([key, value]) => `${key}=${String(value)}`).join(", ")})`;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
