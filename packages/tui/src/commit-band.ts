import { commitTitle, failureTail, SUGGESTING, withSuggestion } from "@golem/view";

import type { Press } from "./keys.ts";

/**
 * The commit band under `/changes`: how many files, the branch, the message on one editable line,
 * and the keys. It holds only what the person sees. The calls are the app's, and a commit starts
 * only from the person pressing enter.
 */
export type CommitBand = {
  branch: string | null;
  /** The files git sees as changed. All of them are committed: picking files is for the web. */
  paths: readonly string[];
  message: string;
  suggesting: boolean;
  committing: boolean;
  /** The last lines of git's output after a commit that did not happen, or a reason it did not start. */
  failure: readonly string[] | null;
  /** Counts keys that changed the message, so a late answer to "suggest again" does not undo typing. */
  edits: number;
};

export type CommitKey = "enter" | "again" | "back" | "delete" | "clear" | { text: string };

export type CommitAction =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "commit"; message: string }
  /** Ask the model for a message. `edits` is the band's count when asked. */
  | { kind: "suggest"; edits: number };

export const COMMIT_HINT = "enter commit · ctrl+r suggest again · esc";
export const COMMIT_NOTE_LINE = "you commit with your own git and hooks · nothing is pushed";
export const COMMIT_RUN_ACTIVE = "a run is active: commit when it ends";
export const COMMITTING = "committing…";

export function openCommitBand(info: { branch: string | null; paths: readonly string[] }): CommitBand {
  return { branch: info.branch, paths: info.paths, message: "", suggesting: true, committing: false, failure: null, edits: 0 };
}

export function commitKeyOf(press: Press): CommitKey | null {
  if (press.name === "return") return "enter";
  if (press.name === "escape") return "back";
  if (press.name === "ctrl-r") return "again";
  if (press.name === "backspace") return "delete";
  if (press.name === "ctrl-u" || press.name === "ctrl-w") return "clear";
  const text = press.input.replace(/[\r\n]/g, "");
  if ((press.name === null || press.name === "question") && !press.ctrl && !press.meta && text.length > 0) {
    return { text };
  }
  return null;
}

/** `busy` is a run in progress: the files may still change, so nothing is committed now. */
export function pressCommit(band: CommitBand, key: CommitKey, busy: boolean): { band: CommitBand; action: CommitAction } {
  const none = { kind: "none" } as const;
  if (key === "back") {
    return band.committing ? { band, action: none } : { band, action: { kind: "close" } };
  }
  if (band.committing) {
    return { band, action: none };
  }
  if (key === "enter") {
    if (band.message.trim() === "") return { band, action: none };
    if (busy) return { band: { ...band, failure: [COMMIT_RUN_ACTIVE] }, action: none };
    return { band: { ...band, committing: true, failure: null }, action: { kind: "commit", message: band.message } };
  }
  if (key === "again") {
    return { band: { ...band, suggesting: true, failure: null }, action: { kind: "suggest", edits: band.edits } };
  }
  const message = key === "delete" ? Array.from(band.message).slice(0, -1).join("") : key === "clear" ? "" : band.message + key.text;
  return { band: { ...band, message, failure: null, edits: band.edits + 1 }, action: none };
}

/**
 * A suggestion came. It fills an empty message only, unless `replaceAt` is the band's edit count:
 * that is "suggest again", which replaces the message when nothing was typed since it was asked.
 */
export function suggestionArrived(band: CommitBand, text: string, replaceAt: number | null = null): CommitBand {
  const message = replaceAt !== null && replaceAt === band.edits ? text : withSuggestion(band.message, text);
  return { ...band, message, suggesting: false };
}

/** No suggestion could be had. The person types their own. */
export function suggestionFailed(band: CommitBand): CommitBand {
  return { ...band, suggesting: false };
}

/** Git did not commit. Its last lines stay under the message. */
export function commitRefused(band: CommitBand, output: string): CommitBand {
  const rows = failureTail(output);
  return { ...band, committing: false, failure: rows.length === 0 ? ["git gave no output"] : rows };
}

/** The call itself failed before git answered. */
export function commitErrored(band: CommitBand, reason: string): CommitBand {
  return { ...band, committing: false, failure: [reason] };
}

export type CommitRow = { text: string; tone: "plain" | "del"; bold?: boolean; dim?: boolean };

/** The message on one line: a line break shows as `⏎`, and the end stays in view for the cursor. */
function messageLine(band: CommitBand, width: number): string {
  if (band.message === "" && band.suggesting) return `› ${SUGGESTING}`;
  const flat = band.message.replace(/\r?\n/g, " ⏎ ");
  const text = `› ${flat}${band.committing ? "" : "▏"}`;
  return text.length <= width ? text : `…${text.slice(text.length - Math.max(0, width - 1))}`;
}

/** The band's rows: the title, the note, the message, git's refusal if any, and the keys. */
export function layoutCommitBand(band: CommitBand, width: number): CommitRow[] {
  const cut = (text: string): string => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`);
  const rows: CommitRow[] = [
    { text: cut(commitTitle(band.paths.length, band.branch)), tone: "plain", bold: true },
    { text: cut(COMMIT_NOTE_LINE), tone: "plain", dim: true },
    { text: messageLine(band, width), tone: "plain", dim: band.message === "" && band.suggesting },
  ];
  for (const line of band.failure ?? []) {
    rows.push({ text: cut(line), tone: "del" });
  }
  rows.push({ text: cut(band.committing ? COMMITTING : COMMIT_HINT), tone: "plain", dim: true });
  return rows;
}
