import type { ConnectionState } from "@golem/client";

/** The one word for the connection. A refusal says why. */
export function connectionLabel(state: ConnectionState): string {
  switch (state.status) {
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "closed":
      return "closed";
    case "rejected":
      return state.reason;
    case "unauthorized":
      return "unauthorized";
  }
}

/** A problem with golem's service to show while nothing answers, and whether `r` restarts it. */
export type ServiceProblem = { text: string; restart: boolean };

/**
 * What to say while the daemon does not answer.
 *
 * A start error the daemon wrote wins: restarting does not fix it, so the
 * next step it named is shown. Otherwise a launch agent that exists but does
 * not answer can be restarted. With neither there is nothing better to say
 * than the connection word.
 */
export function serviceProblem(
  state: ConnectionState,
  startError: { reason: string; next: string } | null,
  installed: boolean,
): ServiceProblem | null {
  if (state.status !== "reconnecting" && state.status !== "closed") {
    return null;
  }
  if (startError !== null) {
    const next = startError.next.length > 0 ? ` · ${startError.next}` : "";
    return { text: `golem can't start: ${startError.reason}${next}`, restart: false };
  }
  if (installed) {
    return { text: "golem's service isn't answering · r restart · golem daemon logs", restart: true };
  }
  return null;
}
