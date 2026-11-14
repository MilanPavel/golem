/** The line shown under a reply that stopped at the length limit. */
export const REPLY_CUT_NOTE = "The reply stopped at the length limit.";

/** True when the model stopped because it ran out of room to write. */
export function replyWasCut(stopReason: string | null | undefined): boolean {
  return stopReason === "length" || stopReason === "max_tokens";
}
