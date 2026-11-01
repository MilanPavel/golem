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
