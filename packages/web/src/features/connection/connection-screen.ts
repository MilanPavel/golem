import {
  DAEMON_DOWN_CLOSE_CODE,
  PROTOCOL_MAJOR,
  PROTOCOL_MINOR,
  type ConnectionSnapshot,
} from "../../store/connection.ts";
import type { GolemState } from "../../ui/golem-state.ts";

export type ScreenKind = "connecting" | "unauthorized" | "mismatch" | "daemon-down" | "gateway-down";

/** What a full screen says. The page cannot do anything while one is up. */
export type ScreenSpec = {
  kind: ScreenKind;
  tag: string;
  heading: string;
  sentence: string;
  command: string | null;
  golem: GolemState;
};

const MAX_REASON = 40;

// The client words a major mismatch as "protocol major mismatch: client 2, daemon 1".
function shortReason(reason: string): string {
  const daemon = /daemon (\S+)$/.exec(reason);
  if (daemon) {
    return `daemon ${daemon[1]}`;
  }
  return reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON - 1)}…` : reason;
}

const GATEWAY_DOWN = {
  kind: "gateway-down",
  heading: "golem web is not running",
  sentence: "Start it again. You will need the new link it opens.",
  command: "golem web",
  golem: "offline",
} as const;

/** The screen for a connection state, or null when the page can be used. */
export function connectionScreen({ state }: ConnectionSnapshot): ScreenSpec | null {
  switch (state.status) {
    case "connected":
      return null;
    case "connecting":
      return {
        kind: "connecting",
        tag: "connecting",
        heading: "Connecting to golem",
        sentence: "The page is reaching golem's daemon.",
        command: null,
        golem: "offline",
      };
    case "unauthorized":
      return {
        kind: "unauthorized",
        tag: "unauthorized",
        heading: "This page needs a fresh link",
        sentence: "Links last until the gateway restarts. Run this, and use the link it opens.",
        command: "golem web",
        golem: "offline",
      };
    case "rejected":
      return {
        kind: "mismatch",
        tag: `protocol ${PROTOCOL_MAJOR}.${PROTOCOL_MINOR} · ${shortReason(state.reason)}`,
        heading: "The daemon is older than this page",
        sentence: "Restart it, so both speak the same protocol.",
        command: "golem daemon restart",
        golem: "failed",
      };
    case "reconnecting":
      if (state.closeCode === DAEMON_DOWN_CLOSE_CODE) {
        return {
          kind: "daemon-down",
          tag: `reconnecting · attempt ${state.attempt}`,
          heading: "golem's daemon is not running",
          sentence: "Start it. This page reconnects by itself.",
          command: "golem daemon start",
          golem: "offline",
        };
      }
      return { ...GATEWAY_DOWN, tag: `reconnecting · attempt ${state.attempt}` };
    case "closed":
      return { ...GATEWAY_DOWN, tag: "closed" };
  }
}
