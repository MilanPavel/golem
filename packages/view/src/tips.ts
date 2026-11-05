/**
 * Tips in the empty composer (step 1.11.2): one per session, the next one in
 * each new session, so features turn up one at a time. Pure, so the web UI
 * can show the same ones.
 */

export const TIPS = [
  "Tip: /mcp add connects tools such as GitHub",
  "Tip: /skills lists what golem knows how to do",
  "Tip: ? shows the keys",
  "Tip: /sessions switches between chats",
  'Tip: "/model" switches models',
] as const;

/** The tip for the session with this number: 0 is the first, and the list starts over at the end. */
export function tipAt(count: number): string {
  const index = Number.isSafeInteger(count) && count > 0 ? count % TIPS.length : 0;
  return TIPS[index] ?? TIPS[0];
}

/** The stored count, or 0 if there is none or it is not a number. */
export function parseTipCount(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return 0;
  }
  const count = Number(trimmed);
  return Number.isSafeInteger(count) ? count : 0;
}
