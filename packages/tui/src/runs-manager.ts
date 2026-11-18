import type { RunInfo } from "@golem/client";
import {
  runDuration,
  runGroupHeading,
  runGroups,
  runName,
  runNeedsYou,
  runResultLine,
  runRowLine,
  type RunGroup,
} from "@golem/view";

import type { Press } from "./keys.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";

/**
 * `/runs`: everything automation did, in the groups the web shows (Needs you, Running, Today,
 * Earlier). Enter opens the run's chat, and a run that waits opens with its approval. The runs are
 * the app's list, so this state only says where the pointer is. The words come from `@golem/view`.
 */
export type RunsManagerState = { open: boolean; selected: number };

/** The runs `run.list` returned, or why it could not. */
export type RunList = { runs: readonly RunInfo[] | null; error: string | null };

export const closedRunsManager: RunsManagerState = { open: false, selected: 0 };

export type RunsManagerKey = "up" | "down" | "enter" | "back";

export type RunsManagerAction = { kind: "none" } | { kind: "close" } | { kind: "open"; sessionId: string };

/** The same row shape as the MCP manager, so one component draws both. */
export type RunsManagerLine = McpManagerLine;

const LIST_HINT = "↑/↓ to navigate · Enter to open · Esc to close";
const NO_RUNS = "Nothing has run yet. Routines and golem ask --detach show up here.";

export function openRunsManager(): RunsManagerState {
  return { open: true, selected: 0 };
}

export function runsManagerKeyOf(press: Press): RunsManagerKey | null {
  if (press.name === "up" || press.name === "down") {
    return press.name;
  }
  if (press.name === "return") {
    return "enter";
  }
  return press.name === "escape" ? "back" : null;
}

/** Every run in the order of the screen: the groups one after the other. */
export function orderedRuns(runs: readonly RunInfo[], now: number): RunInfo[] {
  return runGroups(runs, now).flatMap((group) => group.items);
}

export function pressRunsManager(
  state: RunsManagerState,
  runs: readonly RunInfo[],
  key: RunsManagerKey,
  now: number,
): { state: RunsManagerState; action: RunsManagerAction } {
  const items = orderedRuns(runs, now);
  const selected = clamp(state.selected, items.length);
  if (key === "back") {
    return { state: closedRunsManager, action: { kind: "close" } };
  }
  if (key === "up" || key === "down") {
    return { state: { ...state, selected: clamp(selected + (key === "up" ? -1 : 1), items.length) }, action: { kind: "none" } };
  }
  const run = items[selected];
  return { state, action: run === undefined ? { kind: "none" } : { kind: "open", sessionId: run.session_id } };
}

/** ! needs you, ● running, ✔ finished, ✘ failed, ○ skipped or stopped. */
export function runMark(run: RunInfo): { text: string; tone: McpTone } {
  if (runNeedsYou(run)) return { text: "!", tone: "wait" };
  if (run.status === "running" || run.status === "queued") return { text: "●", tone: "ok" };
  if (run.status === "succeeded") return { text: "✔", tone: "ok" };
  if (run.status === "failed") return { text: "✘", tone: "bad" };
  return { text: "○", tone: "off" };
}

/** `2 need you · 1 running · 4 today`: what to look at first. Empty groups are left out. */
function countLine(groups: readonly RunGroup<RunInfo>[]): string {
  const parts = groups.map((group) => {
    const count = group.items.length;
    if (group.label === "Needs you") return `${count} need${count === 1 ? "s" : ""} you`;
    return `${count} ${group.label === "Running" ? "running" : group.label === "Today" ? "today" : "earlier"}`;
  });
  return parts.join(" · ");
}

export function layoutRunsManager(input: {
  state: RunsManagerState;
  list: RunList;
  now: number;
  columns: number;
  rows: number;
}): RunsManagerLine[] {
  const width = Math.max(1, input.columns);
  const room = Math.max(0, input.rows - 2);
  let body: RunsManagerLine[];
  if (input.list.error !== null) {
    body = [{ text: "Runs", bold: true }, { text: "" }, { text: input.list.error }];
  } else if (input.list.runs === null) {
    body = [{ text: "Runs", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  } else {
    body = scrollToSelected(listLines(input.list.runs, input.state.selected, input.now), room);
  }
  const lines = [...body.slice(0, room), { text: "" }, { text: LIST_HINT, dim: true }];
  return lines.slice(0, Math.max(0, input.rows)).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}

function listLines(runs: readonly RunInfo[], selected: number, now: number): RunsManagerLine[] {
  const groups = runGroups(runs, now);
  if (groups.length === 0) {
    return [{ text: "Runs", bold: true }, { text: "no runs", dim: true }, { text: "" }, { text: NO_RUNS }];
  }
  const items = groups.flatMap((group) => group.items);
  const nameWidth = Math.max(...items.map((run) => runName(run).length));
  const rowWidth = Math.max(...items.map((run) => runRowLine(run, now).length));
  const tookWidth = Math.max(...items.map((run) => runDuration(run, now).length));
  const chosen = clamp(selected, items.length);
  const lines: RunsManagerLine[] = [{ text: "Runs", bold: true }, { text: countLine(groups), dim: true }];
  let index = 0;
  for (const group of groups) {
    lines.push({ text: "" }, { text: `  ${runGroupHeading(group)}`, bold: true });
    for (const run of group.items) {
      lines.push({
        prefix: index === chosen ? "❯ " : "  ",
        mark: runMark(run),
        text: `${runName(run).padEnd(nameWidth)}  ${runRowLine(run, now).padEnd(rowWidth)}  ${runDuration(run, now).padEnd(tookWidth)}  ${runResultLine(run)}`.trimEnd(),
        selected: index === chosen,
      });
      index += 1;
    }
  }
  return lines;
}

/** Keep the selected line on screen, with the title lines above it when they fit. */
function scrollToSelected(lines: RunsManagerLine[], room: number): RunsManagerLine[] {
  if (lines.length <= room) {
    return lines;
  }
  const selected = Math.max(0, lines.findIndex((line) => line.selected === true));
  const start = Math.min(Math.max(0, selected - room + 1), lines.length - room);
  return lines.slice(start, start + room);
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
