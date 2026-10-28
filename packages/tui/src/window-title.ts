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

/** What golem is doing, as one mark: no daemon, an approval, working, an error, or idle. */
export function titleMark(state: Omit<TitleState, "title">): string {
  if (state.connection !== "connected") {
    return OFFLINE_MARK;
  }
  if (state.phase === "waiting") {
    return APPROVAL_MARK;
  }
  if (state.phase !== null) {
    const frames = TITLE_SPINNER.length;
    return TITLE_SPINNER[((state.frame % frames) + frames) % frames] ?? IDLE_MARK;
  }
  return state.error ? ERROR_MARK : IDLE_MARK;
}

/**
 * The tab title: the mark, the session title, then `(golem)`, as Claude Code
 * shows `(claude)`. The title comes first, so a narrow tab keeps what tells
 * sessions apart. A session with no title yet is only `golem`.
 */
export function windowTitle(state: TitleState): string {
  const title = state.title.trim();
  const named = title.length > 0 && title !== UNTITLED;
  return `${titleMark(state)} ${named ? `${title} (golem)` : "golem"}`;
}

/** OSC 0 sets the icon and window title. Controls in the name are dropped. */
export function oscWindowTitle(title: string): string {
  const safe = title.replace(/[\u0000-\u001f\u007f]/g, "");
  return `${ESC}]0;${safe}\u0007`;
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
