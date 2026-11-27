/**
 * Helpers in the session list (ADR-059). A helper is a child session, with `parent_session_id` set. It is
 * not a row of its own: its lead's row shows one small square for each helper that is not done, and
 * while that lead is open its helpers are lighter rows under it. Pure, so the web
 * list and the TUI switcher group the same way.
 */

import type { StateSession } from "./wait.ts";

/** What a square says: the helper runs, its call waits in line, or it asks you. */
export type HelperSquare = "working" | "queued" | "asking";

/** The part of a summary the grouping reads. An older daemon leaves `parent_session_id` out. */
export interface HelperSession extends StateSession {
  session_id: string;
  parent_session_id?: string | null;
  /** The agent type of a helper, such as `explorer`. */
  agent?: string | null;
  title?: string | null;
  created_at?: string;
  /** Set once the daemon has trimmed a finished helper to its receipt. An older daemon never sends it. */
  trimmed_at?: string | null;
  /** `workflow:<name>` for the headless session of a workflow run. Such a session is never a row. */
  origin?: string | null;
}

/** True for the headless session of a workflow run: it opens by its id, and the Sessions list skips it. */
export function isWorkflowSession(session: { origin?: string | null }): boolean {
  return typeof session.origin === "string" && session.origin.startsWith("workflow:");
}

/** True for a helper whose steps the daemon has trimmed: it is no row. */
export function isTrimmedHelper(session: { trimmed_at?: string | null }): boolean {
  return session.trimmed_at !== undefined && session.trimmed_at !== null;
}

/** What a helper row shows, as on the helper card: the three squares, or done. */
export type HelperRowState = HelperSquare | "done";

/** The state of a helper row. */
export function helperRowState(session: StateSession): HelperRowState {
  return helperSquare(session) ?? "done";
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

/** The agent type of a helper (`helper` when the daemon names none) and its brief: the title without its `<agent> · ` lead. */
export function helperLabel(session: HelperSession): { agent: string; brief: string } {
  const agent = session.agent !== undefined && session.agent !== null && session.agent !== "" ? session.agent : "helper";
  const title = (session.title ?? "").trim();
  const lead = `${agent} · `;
  return { agent, brief: title.startsWith(lead) ? title.slice(lead.length).trim() : title };
}

export type HelperRows<T> = {
  /** The sessions that are rows, in the order they came. A helper is never one. */
  rows: T[];
  /** For a lead that has helpers not done, one square each, in the order the helpers came. */
  squares: Map<string, HelperSquare[]>;
  /** The same helpers' summaries, in the same order, for the card on the lead's row. */
  helpers: Map<string, T[]>;
  /**
   * The helpers that are rows under their lead, in the order of the call. Only the lead that is open has
   * any. A trimmed helper is left out. A lead in here shows no squares.
   */
  nested: Map<string, T[]>;
};

/** Options of {@link groupHelpers}. */
export type GroupHelpersOptions = {
  /** The chat in view: a lead, or one of its helpers. The lead it names has its helpers as rows. */
  openId?: string | null;
};

/** The order of the call: by start time, and the order they came for equal or unreadable times. */
function byCall<T extends HelperSession>(list: readonly T[]): T[] {
  const time = (session: T): number => {
    const at = session.created_at === undefined ? Number.NaN : Date.parse(session.created_at);
    return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
  };
  return list
    .map((session, index) => ({ session, index }))
    .sort((a, b) => {
      const ta = time(a.session);
      const tb = time(b.session);
      return ta === tb ? a.index - b.index : ta < tb ? -1 : 1;
    })
    .map((entry) => entry.session);
}

/**
 * Take the helpers out of the rows. Each lead gets squares for its helpers that are not done, and the
 * lead that is open (see `openId`) gets them as nested rows. A helper
 * is never a row on its own, and not when its lead is not in the list.
 */
export function groupHelpers<T extends HelperSession>(sessions: readonly T[], options: GroupHelpersOptions = {}): HelperRows<T> {
  const ids = new Set(sessions.map((session) => session.session_id));
  const squares = new Map<string, HelperSquare[]>();
  const helpers = new Map<string, T[]>();
  const all = new Map<string, T[]>();
  const rows: T[] = [];
  const openLead = openLeadOf(sessions, options.openId ?? null);
  for (const session of sessions) {
    const lead = session.parent_session_id;
    if (lead === undefined || lead === null) {
      // The daemon leaves these out of `session.list`, but a pushed summary can still bring one.
      if (!isWorkflowSession(session)) rows.push(session);
      continue;
    }
    if (!ids.has(lead)) continue;
    if (!isTrimmedHelper(session)) {
      const mine = all.get(lead);
      if (mine) mine.push(session);
      else all.set(lead, [session]);
    }
    const square = helperSquare(session);
    if (square !== null) {
      const list = squares.get(lead);
      if (list) list.push(square);
      else squares.set(lead, [square]);
      const running = helpers.get(lead);
      if (running) running.push(session);
      else helpers.set(lead, [session]);
    }
  }
  const nested = new Map<string, T[]>();
  for (const [lead, list] of all) {
    if (lead === openLead) nested.set(lead, byCall(list));
  }
  return { rows, squares, helpers, nested };
}

/** The lead the open chat belongs to: the chat itself, or the lead of it when it is a helper. */
function openLeadOf(sessions: readonly HelperSession[], openId: string | null): string | null {
  if (openId === null) return null;
  const open = sessions.find((session) => session.session_id === openId);
  return open?.parent_session_id ?? openId;
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

/** `2 helpers working, 1 helper asks you` from the counts on a lead's summary (`helpers_running`, `helpers_waiting`). Null for none. */
export function helperCountWords(running: number | null | undefined, waiting: number | null | undefined): string | null {
  const squares: HelperSquare[] = [...Array<HelperSquare>(Math.max(0, running ?? 0)).fill("working"), ...Array<HelperSquare>(Math.max(0, waiting ?? 0)).fill("asking")];
  return helperWords(squares);
}
