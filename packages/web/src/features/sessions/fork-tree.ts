import type { SessionSummary } from "../../store/session-list.ts";

/** How many steps of indent a fork gets. Deeper forks line up with the third level. */
export const MAX_INDENT = 3;

export type ForkRow = {
  session: SessionSummary;
  /** 0 for a top-level session, 1 for a fork of one, and so on. */
  depth: number;
  /** `depth`, capped at {@link MAX_INDENT}: the steps to indent. */
  indent: number;
  /** True for a session that was forked from another, whether or not the parent is shown. */
  forked: boolean;
  /** The title of the parent when it is in this list, null for no title or a parent that is not shown. */
  parentTitle: string | null;
  /** True when the parent is in this list. */
  parentShown: boolean;
};

/**
 * One folder's sessions with each fork right under its parent. Sessions keep the order they
 * came in, so siblings stay newest first and parents keep their order. A fork whose parent is
 * not in the list is a top-level row.
 */
export function forkRows(sessions: readonly SessionSummary[]): ForkRow[] {
  const byId = new Map(sessions.map((session) => [session.session_id, session]));
  const children = new Map<string, SessionSummary[]>();
  const roots: SessionSummary[] = [];
  for (const session of sessions) {
    const parent = session.forked_from ?? null;
    if (parent !== null && parent !== session.session_id && byId.has(parent)) {
      const siblings = children.get(parent);
      if (siblings) siblings.push(session);
      else children.set(parent, [session]);
    } else {
      roots.push(session);
    }
  }

  const rows: ForkRow[] = [];
  const seen = new Set<string>();
  const visit = (session: SessionSummary, depth: number): void => {
    if (seen.has(session.session_id)) return;
    seen.add(session.session_id);
    const parent = session.forked_from === undefined || session.forked_from === null ? undefined : byId.get(session.forked_from);
    rows.push({
      session,
      depth,
      indent: Math.min(depth, MAX_INDENT),
      forked: session.forked_from !== undefined && session.forked_from !== null,
      parentTitle: parent?.title ?? null,
      parentShown: parent !== undefined,
    });
    for (const child of children.get(session.session_id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // A loop of forks has no root; show whatever the walk did not reach, at the top.
  for (const session of sessions) visit(session, 0);
  return rows;
}
