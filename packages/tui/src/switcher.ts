import type { SessionSummary } from "@golem/client";

/** The selection is a session id, so it stays put while live summaries reorder the list. */
export type SwitcherState = { open: boolean; selected: string | null };

export const closedSwitcher: SwitcherState = { open: false, selected: null };

export type SwitcherKey = "up" | "down" | "enter" | "new" | "close";

export type SwitcherAction =
  | { kind: "none" }
  | { kind: "open"; sessionId: string }
  | { kind: "new" }
  | { kind: "close" };

export type SwitcherRow = {
  sessionId: string;
  selected: boolean;
  current: boolean;
  running: boolean;
  title: string;
  age: string;
};

export const SWITCHER_HINT = "↑↓ move · Enter open · n new · Esc close";
export const NO_SESSIONS = "No sessions yet. Press n to start one.";
export const UNTITLED = "untitled";

export function openSwitcher(current: string | null): SwitcherState {
  return { open: true, selected: current };
}

/** Apply one key while the switcher is open. Enter on the current session just closes it. */
export function pressSwitcher(
  state: SwitcherState,
  sessions: readonly SessionSummary[],
  key: SwitcherKey,
  current: string | null,
): { state: SwitcherState; action: SwitcherAction } {
  if (key === "close") {
    return { state: closedSwitcher, action: { kind: "close" } };
  }
  if (key === "new") {
    return { state: closedSwitcher, action: { kind: "new" } };
  }
  const index = selectedIndex(state, sessions);
  if (key === "enter") {
    const chosen = sessions[index];
    if (chosen === undefined || chosen.session_id === current) {
      return { state: closedSwitcher, action: { kind: "close" } };
    }
    return { state: closedSwitcher, action: { kind: "open", sessionId: chosen.session_id } };
  }
  const step = key === "up" ? -1 : 1;
  const next = sessions[Math.min(Math.max(index + step, 0), sessions.length - 1)];
  return { state: { ...state, selected: next?.session_id ?? null }, action: { kind: "none" } };
}

/** At most `rows` sessions, scrolled so the selected one is visible. */
export function layoutSwitcher(input: {
  state: SwitcherState;
  sessions: readonly SessionSummary[];
  current: string | null;
  now: number;
  columns: number;
  rows: number;
}): SwitcherRow[] {
  const { sessions, rows } = input;
  if (rows <= 0) {
    return [];
  }
  const index = selectedIndex(input.state, sessions);
  const start = Math.min(Math.max(0, index - rows + 1), Math.max(0, sessions.length - rows));
  return sessions.slice(start, start + rows).map((summary, offset) => {
    const age = relativeAge(summary.updated_at, input.now);
    return {
      sessionId: summary.session_id,
      selected: start + offset === index,
      current: summary.session_id === input.current,
      running: summary.status === "running",
      title: fit(summary.title ?? UNTITLED, input.columns - ROW_CHROME - age.length),
      age,
    };
  });
}

/** `now`, then minutes, hours, and days, then the date. */
export function relativeAge(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  return new Date(then).toISOString().slice(0, 10);
}

/** Pointer, dot, and the spaces around them and the age. */
const ROW_CHROME = 6;

function selectedIndex(state: SwitcherState, sessions: readonly SessionSummary[]): number {
  const found = sessions.findIndex((summary) => summary.session_id === state.selected);
  return found < 0 ? 0 : found;
}

function fit(text: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
