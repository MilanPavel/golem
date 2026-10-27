import type { ModelServerStatus } from "@golem/client";

/** The newest `model.server.status` state of each local model server, by provider. */
export type ServerStates = Readonly<Record<string, ModelServerStatus["state"]>>;

export function applyServerStatus(states: ServerStates, status: ModelServerStatus): ServerStates {
  return { ...states, [status.provider]: status.state };
}

/**
 * The provider to name in the meter while its server starts, or null. With
 * no provider for the session's model, any server that is starting counts.
 */
export function startingServer(states: ServerStates, provider: string | null): string | null {
  if (provider !== null) {
    return states[provider] === "starting" ? provider : null;
  }
  return Object.keys(states).find((name) => states[name] === "starting") ?? null;
}

/** The banner for a server that did not start, or null for any other state. */
export function serverFailedNotice(status: ModelServerStatus): string | null {
  if (status.state !== "failed") {
    return null;
  }
  return status.message == null
    ? `${status.provider} did not start`
    : `${status.provider} did not start: ${status.message}`;
}
