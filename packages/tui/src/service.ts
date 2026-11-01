/** What the chat screen may ask about golem's background service. */
export type ServiceControl = {
  /** Why the daemon could not start, as it wrote to `run/last-error`. */
  startError: () => { reason: string; next: string } | null;
  /** True when the launch agent exists, so launchd should be running the daemon. */
  installed: () => boolean;
  /** `golem daemon restart`. Rejects with why it failed. Null when this screen cannot restart it. */
  restart: (() => Promise<void>) | null;
};

export const RESTARTING = "restarting golem's service…";
