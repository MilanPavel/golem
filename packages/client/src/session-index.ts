import type { SessionSummary } from "../../protocol/gen/session-list-result.ts";

/**
 * Put `next` into `index`, newest activity first, one entry per session.
 *
 * A `session.list` result and `session.summary` notifications can arrive in
 * either order. The summary with the higher `last_seq` is the newer one, so an
 * older copy never replaces a newer one.
 */
export function mergeSummary(index: readonly SessionSummary[], next: SessionSummary): readonly SessionSummary[] {
  const current = index.find((summary) => summary.session_id === next.session_id);
  if (current !== undefined && current.last_seq > next.last_seq) {
    return index;
  }
  return [...index.filter((summary) => summary.session_id !== next.session_id), next].sort(byActivity);
}

function byActivity(a: SessionSummary, b: SessionSummary): number {
  if (a.updated_at !== b.updated_at) {
    return a.updated_at < b.updated_at ? 1 : -1;
  }
  if (a.session_id === b.session_id) {
    return 0;
  }
  return a.session_id < b.session_id ? 1 : -1;
}
