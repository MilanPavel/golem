import type { InboxListResult, InboxPost, RoutineConfig, RoutineGetResult, RoutineInfo, RoutineListResult, RoutineRunResult, RoutineRunSummary } from "@golem/client";

export type { InboxListResult, InboxPost, RoutineConfig, RoutineGetResult, RoutineInfo, RoutineListResult, RoutineRunResult, RoutineRunSummary };

/** The query key of `routine.list`. The pushed `routine.changed`, `routine.fired` and `routine.finished` mark it stale. */
export const ROUTINE_LIST_KEY = ["routine.list"] as const;

/** The query key of `inbox.list`: what query routines left in the Inbox. The pushed `routine.*` notifications mark it stale. */
export const INBOX_POSTS_KEY = ["inbox.list"] as const;

/** The query key of `routine.get`, which holds a routine's recent runs. The same pushes mark it stale. */
export const ROUTINE_GET_KEY = ["routine.get"] as const;

/** One routine: a user routine has no folder, a project routine has its project's. */
export function routineGetKey(name: string, folder: string | null): readonly unknown[] {
  return [...ROUTINE_GET_KEY, name, folder];
}
