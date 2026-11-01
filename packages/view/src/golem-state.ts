import type { ConnectionState } from "@golem/client";

/** What a run is doing while it works. */
export type RunPhase = "thinking" | "writing" | "waiting";

/** What golem is doing, as the UI shows it. */
export type GolemState = "idle" | "thinking" | "waiting" | "failed" | "offline";

/** No daemon wins, then an approval, then any work, then an error, then idle. */
export function golemState(input: {
  connection: ConnectionState["status"];
  phase: RunPhase | null;
  error: boolean;
}): GolemState {
  if (input.connection !== "connected") {
    return "offline";
  }
  if (input.phase === "waiting") {
    return "waiting";
  }
  if (input.phase !== null) {
    return "thinking";
  }
  return input.error ? "failed" : "idle";
}
