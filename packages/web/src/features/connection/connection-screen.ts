import { KEEP_ALL_COMMAND } from "@golem/view";
import {
  DAEMON_DOWN_CLOSE_CODE,
  PROTOCOL_MAJOR,
  PROTOCOL_MINOR,
  type ConnectionSnapshot,
} from "../../store/connection.ts";
import type { GolemState } from "../../ui/golem-state.ts";

export type ScreenKind = "connecting" | "unauthorized" | "mismatch" | "daemon-down" | "gateway-down";

/** More to run after the main command, with the words that go before it (or none). */
export type ScreenExtra = { sentence: string | null; command: string };

/** What a full screen says. The page cannot do anything while one is up. */
export type ScreenSpec = {
  kind: ScreenKind;
  tag: string;
  heading: string;
  sentence: string;
  command: string | null;
  extras: readonly ScreenExtra[];
  golem: GolemState;
};

/** What the page knows of its gateway's job, and whether the gateway has been gone too long to be restarting. */
export type ConnectionHost = { kept: boolean | null; overdue: boolean };

/** How long a kept gateway may take to come back before the screen stops promising it. */
export const RESTART_GRACE_MS = 30_000;

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

/** After the command to start it: where to read why a job did not bring it back, or how to keep it running. */
function gatewayExtras(host: ConnectionHost): readonly ScreenExtra[] {
  if (host.kept === true) {
    return [{ sentence: null, command: "golem web logs" }];
  }
  if (host.kept === false) {
    return [{ sentence: "Keeps golem and this page running, even after a restart.", command: KEEP_ALL_COMMAND }];
  }
  return [];
}

/**
 * The screen for a connection state, or null when the page can be used. `host` is what
 * `/healthz` said of the gateway: when a job keeps it and it has been gone only a moment, the
 * screen says it is restarting and shows no command.
 */
export function connectionScreen(
  { state }: ConnectionSnapshot,
  host: ConnectionHost = { kept: null, overdue: false },
): ScreenSpec | null {
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
        extras: [],
        golem: "offline",
      };
    case "unauthorized":
      return {
        kind: "unauthorized",
        tag: "unauthorized",
        heading: "This page needs a fresh link",
        sentence: "Links last until the gateway restarts. Run this, and use the link it opens.",
        command: "golem web",
        extras: [],
        golem: "offline",
      };
    case "rejected":
      return {
        kind: "mismatch",
        tag: `protocol ${PROTOCOL_MAJOR}.${PROTOCOL_MINOR} · ${shortReason(state.reason)}`,
        heading: "The daemon is older than this page",
        sentence: "Restart it, so both speak the same protocol.",
        command: "golem daemon restart",
        extras: [],
        golem: "failed",
      };
    case "reconnecting":
      if (state.closeCode === DAEMON_DOWN_CLOSE_CODE) {
        return {
          kind: "daemon-down",
          tag: `reconnecting · attempt ${state.attempt}`,
          heading: "golem's daemon is not running",
          sentence: "Start it, and this page reconnects by itself. If it does not start, golem status says why.",
          command: "golem daemon start",
          extras: [],
          golem: "offline",
        };
      }
      if (host.kept === true && !host.overdue) {
        return {
          kind: "gateway-down",
          tag: "reconnecting",
          heading: "golem's page server is restarting",
          sentence: "It comes back by itself, usually within a few seconds. This page reconnects when it does.",
          command: null,
          extras: [],
          golem: "offline",
        };
      }
      return { ...GATEWAY_DOWN, tag: `reconnecting · attempt ${state.attempt}`, extras: gatewayExtras(host) };
    case "closed":
      return { ...GATEWAY_DOWN, tag: "closed", extras: gatewayExtras(host) };
  }
}
