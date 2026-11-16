import type { ChangedFile, ChangesCommitInfoResult, ChangesCommitResult, ChangesDiffResult, ChangesListResult } from "@golem/client";

export type { ChangedFile, ChangesCommitInfoResult, ChangesCommitResult, ChangesDiffResult, ChangesListResult };

/** How long a burst of `file.changed` events waits, so it makes one request. */
export const CHANGES_REFETCH_MS = 150;

/** The query key of `changes.list`. A `file.changed` event for the session marks it stale. */
export function changesListKey(sessionId: string): readonly unknown[] {
  return ["changes.list", sessionId];
}

/** The query key of `changes.diff` for one file. A `file.changed` event for the session marks it stale. */
export function changesDiffKey(sessionId: string, path: string): readonly unknown[] {
  return ["changes.diff", sessionId, path];
}

/** The query key of `changes.diff` for one change. A change never changes, but the key shares the prefix so a reset drops it too. */
export function changeDiffKey(sessionId: string, changeId: string): readonly unknown[] {
  return ["changes.diff", sessionId, "change", changeId];
}

/** The query key of `changes.commit_info`. A `file.changed` event for the session marks it stale. */
export function commitInfoKey(sessionId: string): readonly unknown[] {
  return ["changes.commit_info", sessionId];
}

/** What the Changes tab reads for the list. */
export type ChangedFiles = { files: ChangedFile[] | null; error: string | null };

/** What the Changes tab reads for one file's diff. */
export type FileDiff = { diff: string | null; truncated: boolean; error: string | null };
