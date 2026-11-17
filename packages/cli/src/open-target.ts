import { sessionPath } from "./ask.ts";

/** Where `[notifications] open_in` sends a click. Anything else reads as the default, `web`. */
export type OpenIn = "web" | "terminal";

/** What `golem open <id> --notified` does: the web page at `path`, or the terminal chat on `sessionId`. */
export type OpenTarget = { kind: "web"; path: string } | { kind: "terminal"; sessionId: string; args: string[] };

/** The setting as the daemon reports it. A daemon that predates it, or a value we do not know, means `web`. */
export function readOpenIn(value: unknown): OpenIn {
  return value === "terminal" ? "terminal" : "web";
}

/** The arguments that open the terminal chat on a session. */
export function terminalArgs(sessionId: string): string[] {
  return ["open", sessionId];
}

/**
 * Where a click on a notification about `sessionId` lands. `web` is the page at `/s/<id>`, unless the
 * web job is not installed, and then the terminal, which needs no job. A later click mechanism calls this too.
 */
export function chooseTarget(sessionId: string, openIn: OpenIn, webInstalled: boolean): OpenTarget {
  if (openIn === "web" && webInstalled) return { kind: "web", path: sessionPath(sessionId) };
  return { kind: "terminal", sessionId, args: terminalArgs(sessionId) };
}
