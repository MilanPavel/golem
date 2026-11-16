import type { FileListResult, FileReadResult } from "@golem/client";

export type { FileListResult, FileReadResult };

/** The query key of `file.list`. */
export function fileListKey(sessionId: string, query: string, hidden: boolean): readonly unknown[] {
  return ["file.list", sessionId, query, hidden];
}

/** The query key of `file.read`. A `file.changed` event for the session marks it stale. */
export function fileReadKey(sessionId: string, path: string): readonly unknown[] {
  return ["file.read", sessionId, path];
}

/** What the Files tab reads for one file. */
export type FileRead = { file: FileReadResult | null; error: string | null };
