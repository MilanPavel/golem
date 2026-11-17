/**
 * Who started a session, and whether it waits for the user. Pure, so the web and the terminal
 * mark a routine's session the same way. The input is typed by its shape, as the wire's session
 * summary has it.
 */

/** The part of a session summary the origin mark reads. */
export interface OriginSession {
  origin?: string | null;
  status?: string;
}

/** The mark shown before a routine's title. */
export const ROUTINE_MARK = "⏱";

const ROUTINE_PREFIX = "routine:";

/** The routine that started the session, or null when it was not started by one. */
export function routineName(session: OriginSession): string | null {
  const origin = session.origin;
  if (typeof origin !== "string" || !origin.startsWith(ROUTINE_PREFIX)) {
    return null;
  }
  const name = origin.slice(ROUTINE_PREFIX.length);
  return name.length > 0 ? name : null;
}

/** True for a session a routine started. */
export function isRoutineSession(session: OriginSession): boolean {
  return typeof session.origin === "string" && session.origin.startsWith(ROUTINE_PREFIX);
}

/**
 * The words for a session that something other than the user started, or null for the user's
 * own: `routine digest` for a routine, the origin itself for any other (`cli` is the user's own).
 */
export function originLabel(session: OriginSession): string | null {
  const origin = session.origin;
  if (typeof origin !== "string" || origin === "" || origin === "user" || origin === "cli") {
    return null;
  }
  const name = routineName(session);
  if (name !== null) {
    return `routine ${name}`;
  }
  return isRoutineSession(session) ? "routine" : origin;
}

/** True while the session waits for the user to answer a question. */
export function isWaiting(session: OriginSession): boolean {
  return session.status === "waiting";
}
