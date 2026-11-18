import type { RunInfo, RunListResult } from "@golem/client";

export type { RunInfo, RunListResult };

/** The query key of `run.list`. The pushed `routine.*` notifications and a headless session's summary mark it stale. */
export const RUN_LIST_KEY = ["run.list"] as const;

/** The key of one session's row, for the banner of a routine's session. It sits under `RUN_LIST_KEY`, so it goes stale with it. */
export function sessionRunKey(sessionId: string): readonly unknown[] {
  return [...RUN_LIST_KEY, sessionId];
}
