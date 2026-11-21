/**
 * The Inbox: everything the sessions wait for, with the words each item shows. Pure, so the web
 * and the terminal say the same thing. The input is typed by its shape, as the wire's session
 * summary has it, so this file does not depend on the generated types.
 */

/** What a session waits for, as its summary carries it. */
export interface InboxPending {
  kind: "approval" | "consent";
  since: string;
  call_id?: string | null;
  name?: string | null;
  subject?: string | null;
  source?: string | null;
  added?: number | null;
  removed?: number | null;
  alternatives?: number | null;
  /** The helper that asks, for an item in a lead's `pending_items`. */
  helper?: { session_id: string; agent: string; label?: string | null; index: number } | null;
  /** How many helpers ask this same question; the item is listed once. */
  count?: number | null;
}

/** The part of a session summary the Inbox reads. */
export interface InboxSession {
  session_id: string;
  title?: string | null;
  status: string;
  pending?: InboxPending | null;
  /** Everything the session waits for, a lead's helpers included. An older daemon leaves it out. */
  pending_items?: InboxPending[] | null;
}

/** The items of a summary: `pending_items` when the daemon sends it, else `[pending]`, else none. */
export function pendingItemsOf(session: Pick<InboxSession, "pending" | "pending_items">): InboxPending[] {
  if (session.pending_items !== undefined && session.pending_items !== null && session.pending_items.length > 0) {
    return session.pending_items;
  }
  return session.pending === undefined || session.pending === null ? [] : [session.pending];
}

/** One question that waits for the user. `age` is text only; ticking it live is the panel's job. */
export interface InboxItem {
  sessionId: string;
  sessionTitle: string;
  kind: "approval" | "consent";
  /** The tool call to answer; null for a consent. */
  callId: string | null;
  headline: string;
  /** The rule that asked; null for a consent. */
  source: string | null;
  /** The time the question was asked, as the daemon wrote it. */
  since: string;
  age: string;
  added: number | null;
  removed: number | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SUBJECT_LIMIT = 80;
const UNTITLED = "Untitled";

/** How long ago: `now` under a minute, then `4m`, `2h`, `3d`. Empty when the time is unreadable. */
function ageText(since: string, now: number): string {
  const then = Date.parse(since);
  if (Number.isNaN(then)) {
    return "";
  }
  const age = now - then;
  if (age < MINUTE) return "now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  return `${Math.floor(age / DAY)}d`;
}

/** The subject as one line, cut at 80 characters; `{}` and `[]` name nothing. */
function oneLine(subject: string | null | undefined): string {
  if (subject === null || subject === undefined) return "";
  const line = subject.replace(/\s+/g, " ").trim();
  const bare = line.replace(/\s/g, "");
  if (bare === "{}" || bare === "[]") return "";
  return line.length > SUBJECT_LIMIT ? `${line.slice(0, SUBJECT_LIMIT)}…` : line;
}

/** The last part of a path. */
function fileName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return name === "" ? path : name;
}

function headline(pending: InboxPending): string {
  if (pending.kind === "consent") {
    return "Use a paid model for this message?";
  }
  const name = pending.name ?? "";
  const subject = oneLine(pending.subject);
  const added = pending.added ?? null;
  const removed = pending.removed ?? null;
  if (name === "edit_file" && subject !== "") {
    const counts = added !== null && removed !== null ? ` +${added} −${removed}` : "";
    return `Edit \`${fileName(subject)}\`${counts}`;
  }
  if (name === "write_file" && subject !== "") {
    return `Write \`${fileName(subject)}\`${added !== null ? ` +${added}` : ""}`;
  }
  if (name === "shell" && subject !== "") {
    return `Run \`${subject}\``;
  }
  const tool = name === "" ? "a tool" : `\`${name}\``;
  return subject === "" ? `Use ${tool}` : `Use ${tool} on \`${subject}\``;
}

/** The items that wait, oldest first by `since` (ties by session id). Closed sessions and sessions with nothing pending are left out. */
export function inboxItems(sessions: readonly InboxSession[], now: number): InboxItem[] {
  const items: InboxItem[] = [];
  for (const session of sessions) {
    const pending = session.pending;
    if (pending === null || pending === undefined || session.status === "closed") {
      continue;
    }
    const approval = pending.kind === "approval";
    items.push({
      sessionId: session.session_id,
      sessionTitle: session.title?.trim() ? session.title : UNTITLED,
      kind: pending.kind,
      callId: approval ? (pending.call_id ?? null) : null,
      headline: headline(pending),
      source: approval ? (pending.source ?? null) : null,
      since: pending.since,
      age: ageText(pending.since, now),
      added: approval ? (pending.added ?? null) : null,
      removed: approval ? (pending.removed ?? null) : null,
    });
  }
  return items.sort((a, b) => {
    const ta = Date.parse(a.since);
    const tb = Date.parse(b.since);
    if (ta !== tb && !Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
    if (a.since !== b.since) return a.since < b.since ? -1 : 1;
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
  });
}
