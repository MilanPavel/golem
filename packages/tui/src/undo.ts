import type { ChatEvent, ChangesRevertResult } from "@golem/client";
import { type ChangesState } from "@golem/view";

/**
 * `/undo`: take back the files the newest turn that changed any. The turns and
 * their files come from the view's `ChangesState`; this file adds what the
 * view does not keep (the words of each turn) and the question band.
 */

/** The words a turn was asked with, and which user message it was. */
export type RunPrompt = { number: number; text: string };

export type Prompts = {
  /** User messages seen so far. */
  users: number;
  last: string;
  byRun: Readonly<Record<string, RunPrompt>>;
};

export const noPrompts: Prompts = { users: 0, last: "", byRun: {} };

/** A user message counts a turn, and the run that starts next is that turn. */
export function foldPrompts(state: Prompts, event: ChatEvent): Prompts {
  if (event.type === "message.completed" && event.data.role === "user") {
    return { ...state, users: state.users + 1, last: event.data.text };
  }
  if (event.type === "run.started" && event.run_id != null) {
    return { ...state, byRun: { ...state.byRun, [event.run_id]: { number: state.users, text: state.last } } };
  }
  return state;
}

export type UndoOffer = { runId: string; number: number | null; text: string; paths: string[] };

/** The newest turn that changed files and is not undone, or null. */
export function nextUndo(changes: ChangesState, prompts: Prompts): UndoOffer | null {
  for (let index = changes.turns.length - 1; index >= 0; index -= 1) {
    const turn = changes.turns[index];
    if (turn === undefined || turn.reverted || turn.runId === null || turn.files.length === 0) {
      continue;
    }
    const prompt = prompts.byRun[turn.runId];
    return {
      runId: turn.runId,
      number: prompt?.number ?? null,
      text: prompt?.text ?? "",
      paths: turn.files.map((file) => file.path),
    };
  }
  return null;
}

export const NOTHING_TO_UNDO = "Nothing to undo.";
export const WAIT_FOR_GOLEM = "Wait for golem to finish.";

/** The question on screen. `conflicts` is set once the daemon left files alone. */
export type UndoBand = {
  offer: UndoOffer;
  conflicts: string[] | null;
  /** Files put back by the calls so far. */
  reverted: number;
  /** A call is out, and its answer is awaited. */
  working: boolean;
};

export type UndoKey = "enter" | "escape" | "overwrite" | "keep";

export type UndoAction = { kind: "none" } | { kind: "revert"; runId: string; force: boolean };

export function openUndo(offer: UndoOffer): UndoBand {
  return { offer, conflicts: null, reverted: 0, working: false };
}

export function undoKeyOf(press: { name: string | null; input: string; ctrl: boolean; meta: boolean }): UndoKey | null {
  if (press.name === "return") {
    return "enter";
  }
  if (press.name === "escape") {
    return "escape";
  }
  if (press.name === null && !press.ctrl && !press.meta) {
    if (press.input === "o") {
      return "overwrite";
    }
    if (press.input === "k") {
      return "keep";
    }
  }
  return null;
}

export function pressUndo(band: UndoBand, key: UndoKey): { band: UndoBand | null; action: UndoAction } {
  const none: UndoAction = { kind: "none" };
  if (band.working) {
    return { band, action: none };
  }
  if (key === "escape" || (key === "keep" && band.conflicts !== null)) {
    return { band: null, action: none };
  }
  if (key === "enter" && band.conflicts === null) {
    return { band: { ...band, working: true }, action: { kind: "revert", runId: band.offer.runId, force: false } };
  }
  if (key === "overwrite" && band.conflicts !== null) {
    return { band: { ...band, working: true }, action: { kind: "revert", runId: band.offer.runId, force: true } };
  }
  return { band, action: none };
}

/** What the daemon answered: the notice that closes the band, or the band with its second question. */
export function undoAnswered(
  band: UndoBand,
  result: Pick<ChangesRevertResult, "conflicts" | "reverted">,
): { band: UndoBand | null; notice: string | null } {
  const reverted = band.reverted + result.reverted.length;
  if (result.conflicts.length > 0) {
    return {
      band: { ...band, conflicts: result.conflicts.map((conflict) => conflict.path), reverted, working: false },
      notice: null,
    };
  }
  return { band: null, notice: undoneNotice(reverted) };
}

export function undoneNotice(count: number): string {
  return `Undone: ${count} ${count === 1 ? "file" : "files"} put back. /undo again goes one turn further back.`;
}

export type UndoLine = { text: string; bold?: boolean; dim?: boolean; tone?: "question" };

/** Rows the band wants, at most `screenRows / 2`. */
export function undoRows(band: UndoBand, screenRows: number): number {
  const files = band.conflicts?.length ?? band.offer.paths.length;
  return Math.min(files + 2, Math.max(3, Math.floor(screenRows / 2)));
}

/** The question, the files, and the keys, in `rows` rows. A long list ends with `… and N more`. */
export function undoLines(band: UndoBand, columns: number, rows: number): UndoLine[] {
  const width = Math.max(1, columns);
  const { offer, conflicts } = band;
  const named = offer.number === null ? "undo turn" : `undo turn ${offer.number}`;
  const asked = offer.text.length > 0 ? `${named} "${oneLine(offer.text)}"` : named;
  const paths = conflicts ?? offer.paths;
  const keys = conflicts === null ? " enter undo · esc cancel" : " o overwrite · k keep mine";
  const room = Math.max(0, rows - 2);
  const hidden = paths.length > room ? paths.length - Math.max(0, room - 1) : 0;
  const shown = hidden > 0 ? paths.slice(0, Math.max(0, room - 1)) : paths;
  const rowsOut: UndoLine[] = [{ text: fit(asked, width), bold: true, tone: "question" }];
  for (const path of shown) {
    rowsOut.push({ text: fit(conflicts === null ? `  ${path}` : `  ${path}  changed since golem wrote it`, width) });
  }
  if (hidden > 0 && room > 0) {
    rowsOut.push({ text: fit(`  … and ${hidden} more`, width), dim: true });
  }
  rowsOut.push({ text: fit(keys, width), dim: true });
  return rowsOut.slice(0, rows);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
