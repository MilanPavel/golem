import type { GolemClient } from "@golem/client";
import { COMPACTING, compactLine, type CompactAction } from "@golem/view";

/** What the notice line says while the call runs. */
export function compactWaiting(action: CompactAction): string {
  return action === "summarise" ? COMPACTING : action === "grow" ? "growing the window …" : "clearing …";
}

/**
 * Calls `session.compact` and returns the line to print. A summary can take a minute with a local
 * model, so the caller shows `compactWaiting` meanwhile. Rejects with the daemon's error.
 */
export async function runCompact(
  client: Pick<GolemClient, "compactSession">,
  sessionId: string,
  action: CompactAction,
  focus: string | null,
  now: () => number = Date.now,
): Promise<string> {
  const started = now();
  const result = await client.compactSession(sessionId, action, focus ?? undefined);
  return compactLine(action, result, now() - started);
}
