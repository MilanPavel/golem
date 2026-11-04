import type { OllamaInstallUpdate } from "@golem/client";

/**
 * What the daemon's Ollama install sends (ADR-035), as the terminal's band and the browser's
 * setup window both read it.
 */

export type InstallEvent =
  | { kind: "output"; text: string }
  | { kind: "exit"; code: number | null; stopped: boolean }
  | { kind: "error"; message: string };

/** One update from the daemon's install, as the readers' reducers take it. */
export function installEventOf(update: OllamaInstallUpdate): InstallEvent {
  if (update.kind === "output") {
    return { kind: "output", text: update.text };
  }
  switch (update.done.outcome) {
    case "installed":
      return { kind: "exit", code: 0, stopped: false };
    case "stopped":
      return { kind: "exit", code: null, stopped: true };
    case "failed":
      return { kind: "error", message: update.done.reason ?? "brew install ollama failed" };
  }
}

/** The newest finished line of the output so far, and the unfinished text after it. */
export type InstallTail = { last: string; partial: string };

/** Adds `text` to the tail. A `\r` redraws a line, as a download's progress does: the newest wins. */
export function appendInstallOutput(tail: InstallTail, text: string): InstallTail {
  const lines = (tail.partial + text).split("\n");
  const partial = lines.pop() ?? "";
  const shown = lines.map((line) => line.split("\r").at(-1)?.trim() ?? "").filter((line) => line.length > 0);
  return { last: shown.at(-1) ?? tail.last, partial };
}
