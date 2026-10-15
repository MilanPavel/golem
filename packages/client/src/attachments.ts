import type { Params as ChatEvent } from "../../protocol/gen/rpc-notification.ts";

/**
 * The sessions a client follows and the newest `seq` it has seen in each.
 *
 * After a reconnect the client attaches again from that `seq`. The daemon may
 * replay events the client already has, so `accept` drops anything not newer.
 */
export class Attachments {
  private readonly lastSeq = new Map<string, number>();

  /** Follow `sessionId` from `afterSeq`, or from a newer `seq` already seen. */
  track(sessionId: string, afterSeq: number): void {
    this.lastSeq.set(sessionId, Math.max(this.lastSeq.get(sessionId) ?? 0, afterSeq));
  }

  untrack(sessionId: string): void {
    this.lastSeq.delete(sessionId);
  }

  /** The newest `seq` seen in a followed session, or `undefined`. */
  seen(sessionId: string): number | undefined {
    return this.lastSeq.get(sessionId);
  }

  /** `[sessionId, lastSeq]` for every followed session. */
  entries(): [string, number][] {
    return [...this.lastSeq.entries()];
  }

  /** False for a followed session's event at or below its last seen `seq`. */
  accept(event: ChatEvent): boolean {
    const seen = this.lastSeq.get(event.session_id);
    if (seen === undefined) {
      return true;
    }
    if (event.seq <= seen) {
      return false;
    }
    this.lastSeq.set(event.session_id, event.seq);
    return true;
  }
}
