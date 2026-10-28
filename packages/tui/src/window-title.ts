import type { ConnectionState } from "@golem/client";

import type { MeterPhase } from "./progress.ts";

const ESC = "\u001b";

/** The mark before the title while a run works. It changes once a second, so the tab does not flicker. */
export const TITLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const IDLE_MARK = "✳";
export const APPROVAL_MARK = "!";
export const ERROR_MARK = "✗";
export const OFFLINE_MARK = "○";

/** What `sessionTitleLabel` shows before a session has a title. */
const UNTITLED = "untitled";

export type TitleState = {
  title: string;
  phase: MeterPhase | null;
  error: boolean;
  connection: ConnectionState["status"];
  /** Seconds the run has worked, for the spinner. */
  frame: number;
};

/** xterm saves the icon and window title. Restoring pops that stack. */
export const SAVE_WINDOW_TITLE = `${ESC}[22;0t`;
export const RESTORE_WINDOW_TITLE = `${ESC}[23;0t`;

/** What golem is doing, in the order the tab shows it: no daemon, an approval, working, an error, or idle. */
export type TabState = "offline" | "waiting" | "working" | "error" | "idle";

export function tabState(state: Pick<TitleState, "phase" | "error" | "connection">): TabState {
  if (state.connection !== "connected") {
    return "offline";
  }
  if (state.phase === "waiting") {
    return "waiting";
  }
  if (state.phase !== null) {
    return "working";
  }
  return state.error ? "error" : "idle";
}

/** The state as one mark before the title. */
export function titleMark(state: Omit<TitleState, "title">): string {
  switch (tabState(state)) {
    case "offline":
      return OFFLINE_MARK;
    case "waiting":
      return APPROVAL_MARK;
    case "working": {
      const frames = TITLE_SPINNER.length;
      return TITLE_SPINNER[((state.frame % frames) + frames) % frames] ?? IDLE_MARK;
    }
    case "error":
      return ERROR_MARK;
    case "idle":
      return IDLE_MARK;
  }
}

/**
 * The tab title: the mark, the session title, then `(golem)`, as Claude Code
 * shows `(claude)`. The title comes first, so a narrow tab keeps what tells
 * sessions apart. A session with no title yet is only `golem`. Without
 * `mark`, as in iTerm2 where the tab status shows the state, the mark is left out.
 */
export function windowTitle(state: TitleState, mark = true): string {
  const title = state.title.trim();
  const named = title.length > 0 && title !== UNTITLED;
  const text = named ? `${title} (golem)` : "golem";
  return mark ? `${titleMark(state)} ${text}` : text;
}

/**
 * iTerm2's tab status (OSC 21337): a coloured dot by the title and a word
 * under it. Other terminals do not know it, so it is sent only to iTerm2.
 * tmux would need passthrough, so inside tmux it is not sent.
 */
export function hasTabStatus(env: NodeJS.ProcessEnv): boolean {
  if ((env.TMUX !== undefined && env.TMUX !== "") || env.TERM_PROGRAM === "tmux") {
    return false;
  }
  return env.TERM_PROGRAM === "iTerm.app" || env.LC_TERMINAL === "iTerm2";
}

/** The dot, the word, and the word's colour for each state. */
export const TAB_STATUS: Record<TabState, { dot: string; text: string; color: string }> = {
  idle: { dot: "#00d75f", text: "idle", color: "#888888" },
  working: { dot: "#ff9500", text: "working", color: "#ff9500" },
  waiting: { dot: "#5f87ff", text: "waiting for you", color: "#5f87ff" },
  error: { dot: "#ff5f5f", text: "failed", color: "#ff5f5f" },
  offline: { dot: "#888888", text: "disconnected", color: "#888888" },
};

export function oscTabStatus(state: TabState): string {
  const { dot, text, color } = TAB_STATUS[state];
  return `${ESC}]21337;indicator=${dot};status=${text};status-color=${color}\u0007`;
}

/** Empty values take the dot and the word away. */
export const CLEAR_TAB_STATUS = `${ESC}]21337;indicator=;status=;status-color=\u0007`;

export const TAB_STATUS_ON = hasTabStatus(process.env);

export function applyTabStatus(state: TabState): void {
  if (TAB_STATUS_ON) {
    write(oscTabStatus(state));
  }
}

export function clearTabStatus(): void {
  if (TAB_STATUS_ON) {
    write(CLEAR_TAB_STATUS);
  }
}

/** OSC 0 sets the icon and window title. Controls in the name are dropped. */
export function oscWindowTitle(title: string): string {
  const safe = title.replace(/[\u0000-\u001f\u007f]/g, "");
  return `${ESC}]0;${safe}\u0007`;
}

/**
 * OSC 9;4 progress, which some terminals show on the tab or the dock:
 * `busy` while a run works, `paused` while it waits for an approval, and
 * `none` to clear it. Terminals that do not know it ignore it.
 */
export type TabProgress = "none" | "busy" | "paused";

export function tabProgress(phase: MeterPhase | null): TabProgress {
  if (phase === null) {
    return "none";
  }
  return phase === "waiting" ? "paused" : "busy";
}

const PROGRESS_STATE: Record<TabProgress, string> = { none: "0", busy: "3", paused: "4;0" };

export function oscProgress(progress: TabProgress): string {
  return `${ESC}]9;4;${PROGRESS_STATE[progress]}\u0007`;
}

export const CLEAR_PROGRESS = oscProgress("none");

export function applyProgress(progress: TabProgress): void {
  write(oscProgress(progress));
}

export function clearProgress(): void {
  write(CLEAR_PROGRESS);
}

export function pushWindowTitle(): void {
  write(SAVE_WINDOW_TITLE);
}

export function popWindowTitle(): void {
  write(RESTORE_WINDOW_TITLE);
}

export function applyWindowTitle(title: string): void {
  write(oscWindowTitle(title));
}

function write(data: string): void {
  if (process.stdout.isTTY !== true) {
    return;
  }
  try {
    process.stdout.write(data);
  } catch {
    // The terminal is already gone.
  }
}
