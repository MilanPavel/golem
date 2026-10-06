import type { Ping } from "../../protocol/gen/ping.js";

export type { Ping };

/** Phase 0 placeholder. The Ink client arrives in Phase 1. */
export function pingNonce(event: Ping): string {
  return event.nonce;
}
