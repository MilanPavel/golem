import { type InstallEvent, installEventOf, visibleText } from "@golem/view";

export { type InstallEvent, installEventOf };

/**
 * The band while Ollama installs. The daemon runs `brew install ollama`
 * (ADR-035), so every client sees the same install; this file turns its
 * output into the band's lines.
 */

export const OLLAMA_DOWNLOAD = "https://ollama.com/download";
/** Output lines kept for the band. Older ones are dropped. */
export const INSTALL_KEPT_LINES = 200;
/** The band's height while brew runs: the title and five lines of output. */
export const INSTALL_BAND_ROWS = 6;

export type InstallState =
  | { phase: "running"; lines: string[]; partial: string }
  | { phase: "done"; lines: string[] }
  | { phase: "failed"; lines: string[]; reason: string }
  | { phase: "stopped"; lines: string[] }
  | { phase: "no_brew" };

export type BandLine = { text: string; tone: "title" | "output" | "ok" | "error" | "hint" };

export const startedInstall: InstallState = { phase: "running", lines: [], partial: "" };

/** The install after one event from the brew process. Events after it ended change nothing. */
export function reduceInstall(state: InstallState, event: InstallEvent): InstallState {
  if (state.phase !== "running") {
    return state;
  }
  switch (event.kind) {
    case "output": {
      // A `\r` redraws the line in a terminal, as a download's progress does: keep the newest.
      const parts = (state.partial + event.text).split("\n");
      const partial = parts.pop() ?? "";
      const lines = [...state.lines, ...parts.map(cleanLine).filter((line) => line.length > 0)];
      return { phase: "running", lines: lines.slice(-INSTALL_KEPT_LINES), partial };
    }
    case "exit": {
      const lines = withPartial(state);
      if (event.stopped) {
        return { phase: "stopped", lines };
      }
      if (event.code === 0) {
        return { phase: "done", lines };
      }
      return { phase: "failed", lines, reason: `brew install ollama exited with code ${event.code ?? "?"}` };
    }
    case "error":
      return { phase: "failed", lines: withPartial(state), reason: event.message };
  }
}

/** Rows the band wants: room for output while brew runs or after it failed, one line otherwise. */
export function installRows(state: InstallState): number {
  switch (state.phase) {
    case "running":
      return INSTALL_BAND_ROWS;
    case "failed":
      return Math.min(INSTALL_BAND_ROWS, 2 + state.lines.length);
    case "no_brew":
      return 2;
    case "done":
    case "stopped":
      return 1;
  }
}

/** The band: a title, then the newest output, then how it ended or what to do. */
export function installLines(state: InstallState, columns: number, rows: number): BandLine[] {
  if (rows <= 0) {
    return [];
  }
  const width = Math.max(1, columns);
  const head: BandLine[] = [];
  const tail: BandLine[] = [];
  let output: string[] = [];
  switch (state.phase) {
    case "no_brew":
      head.push({ text: `Homebrew isn't installed. Download Ollama from ${OLLAMA_DOWNLOAD}`, tone: "error" });
      tail.push({ text: "/model to switch to a hosted model", tone: "hint" });
      break;
    case "running":
      head.push({ text: "Installing Ollama with Homebrew · Esc stops", tone: "title" });
      output = state.partial.length > 0 ? [...state.lines, cleanLine(state.partial)] : state.lines;
      break;
    case "done":
      head.push({ text: "Ollama is installed", tone: "ok" });
      break;
    case "failed":
      head.push({ text: `Ollama was not installed: ${state.reason}`, tone: "error" });
      output = state.lines;
      tail.push({ text: "/model to switch to a hosted model", tone: "hint" });
      break;
    case "stopped":
      head.push({ text: "Stopped installing Ollama", tone: "error" });
      break;
  }
  const room = Math.max(0, rows - head.length - tail.length);
  const shown = room === 0 ? [] : output.filter((line) => line.length > 0).slice(-room);
  const lines = [...head, ...shown.map((text): BandLine => ({ text, tone: "output" })), ...tail];
  return lines.slice(0, rows).map((line) => ({ ...line, text: fit(line.text, width) }));
}

function withPartial(state: { lines: string[]; partial: string }): string[] {
  const last = cleanLine(state.partial);
  return (last.length > 0 ? [...state.lines, last] : state.lines).slice(-INSTALL_KEPT_LINES);
}

// Colour and cursor escapes, which brew sends when it thinks it has a terminal.
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

function cleanLine(raw: string): string {
  const redrawn = raw.split("\r").filter((part) => part.length > 0).pop() ?? "";
  return visibleText(redrawn.replace(ESCAPES, "")).replace(/\t/g, "  ").trimEnd();
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1)).trimEnd()}…`;
}
