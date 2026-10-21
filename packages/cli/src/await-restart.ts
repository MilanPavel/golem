import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";

export type RestartWait = {
  /** `daemon.status`, or null while nothing answers. */
  readStatus: () => Promise<DaemonStatus | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs: number;
  pollMs: number;
};

/**
 * Waits for a daemon other than `previousPid` to answer and be running.
 * The old one can still answer while it drains, so its pid does not count.
 */
export async function awaitRestart(
  previousPid: number | null,
  wait: RestartWait,
): Promise<DaemonStatus | null> {
  const deadline = wait.now() + wait.timeoutMs;
  for (;;) {
    const status = await wait.readStatus();
    if (status !== null && status.pid !== previousPid && status.state === "running") {
      return status;
    }
    if (wait.now() >= deadline) {
      return null;
    }
    await wait.sleep(wait.pollMs);
  }
}

export function formatRestarted(status: DaemonStatus | null, timeoutMs: number): string {
  if (status === null) {
    const seconds = Math.round(timeoutMs / 1000);
    return `the daemon did not come back within ${seconds} s; see golem daemon logs and logs/launchd.stderr.log`;
  }
  return `daemon ${status.version} is running (pid ${status.pid})`;
}
