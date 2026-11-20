/**
 * Helpers in the session list (ADR-059). A helper is a child session, with `parent_session_id` set. It is
 * not a row: its lead's row shows one small square for each helper that is not done. Pure, so the web
 * list and the TUI switcher group the same way.
 */

import type { StateSession } from "./wait.ts";

/** What a square says: the helper runs, its call waits in line, or it asks you. */
export type HelperSquare = "working" | "queued" | "asking";

/** The part of a summary the grouping reads. An older daemon leaves `parent_session_id` out. */
export interface HelperSession extends StateSession {
  session_id: string;
  parent_session_id?: string | null;
}

/** True for a helper session. */
export function isHelperSession(session: { parent_session_id?: string | null }): boolean {
  return session.parent_session_id !== undefined && session.parent_session_id !== null;
}

/** The square for one helper, or null when it is done (idle or closed, or a status that is not known). */
export function helperSquare(session: StateSession): HelperSquare | null {
  if (session.status === "waiting" || (session.status === "running" && session.wait_reason === "you")) return "asking";
  if (session.status !== "running") return null;
  return session.wait_reason === undefined || session.wait_reason === null ? "working" : "queued";
}

export type HelperRows<T> = {
  /** The sessions that are rows, in the order they came. */
  rows: T[];
  /** For a lead that has helpers not done, one square each, in the order the helpers came. */
  squares: Map<string, HelperSquare[]>;
  /** The same helpers' summaries, in the same order, for the card on the lead's row. */
  helpers: Map<string, T[]>;
};

/**
 * Take the helpers out of the rows and count them on their lead. A helper is never a row, even when its
 * lead is not in the list. With `showHelpers` they stay rows, as for a daemon that sends no
 * `parent_session_id`, and the leads still show their squares.
 */
export function groupHelpers<T extends HelperSession>(sessions: readonly T[], options: { showHelpers?: boolean } = {}): HelperRows<T> {
  const ids = new Set(sessions.map((session) => session.session_id));
  const squares = new Map<string, HelperSquare[]>();
  const helpers = new Map<string, T[]>();
  const rows: T[] = [];
  for (const session of sessions) {
    const lead = session.parent_session_id;
    if (lead === undefined || lead === null) {
      rows.push(session);
      continue;
    }
    if (options.showHelpers === true) rows.push(session);
    const square = helperSquare(session);
    if (square !== null && ids.has(lead)) {
      const list = squares.get(lead);
      if (list) list.push(square);
      else squares.set(lead, [square]);
      const mine = helpers.get(lead);
      if (mine) mine.push(session);
      else helpers.set(lead, [session]);
    }
  }
  return { rows, squares, helpers };
}

const WORDS: Record<HelperSquare, [one: string, many: string]> = {
  working: ["1 helper working", "helpers working"],
  queued: ["1 helper queued", "helpers queued"],
  asking: ["1 helper asks you", "helpers ask you"],
};

/** `2 helpers working`, `1 helper asks you`, or both joined with a comma. Null for no squares. */
export function helperWords(squares: readonly HelperSquare[]): string | null {
  const parts: string[] = [];
  for (const kind of ["working", "queued", "asking"] as const) {
    const count = squares.filter((square) => square === kind).length;
    if (count > 0) parts.push(count === 1 ? WORDS[kind][0] : `${count} ${WORDS[kind][1]}`);
  }
  return parts.length === 0 ? null : parts.join(", ");
}
