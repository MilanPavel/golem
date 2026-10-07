import type { ConnectionState } from "@golem/client";

export function statusLabel(state: ConnectionState): string {
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
  }
}
