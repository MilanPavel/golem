export type GolemState = "idle" | "thinking" | "waiting" | "failed" | "offline";

/** The word shown beside each state, from docs/design/web.md. Colour is never the only sign. */
export const GOLEM_STATE_LABEL: Record<GolemState, string> = {
  idle: "idle",
  thinking: "working",
  waiting: "waiting for you",
  failed: "last run failed",
  offline: "offline",
};
