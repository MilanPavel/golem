import type { GolemState } from "../../ui/golem-state.ts";

/** Offline when there is no link, else waiting if any session waits, else working if any runs, else idle. */
export function overallState(connected: boolean, sessions: readonly { status: string }[]): GolemState {
  if (!connected) {
    return "offline";
  }
  if (sessions.some((session) => session.status === "waiting")) {
    return "waiting";
  }
  if (sessions.some((session) => session.status === "running")) {
    return "thinking";
  }
  return "idle";
}
