import { bannerText } from "./chrome.ts";

/**
 * A hint: a short message that needs no answer, such as `copied`. It shows on
 * the right of the banner's row and goes away on its own. Errors and messages
 * that ask for something stay in the banner on the left.
 */
export type Hint = { text: string; until: number };

/** How long a hint shows. */
export const HINT_MS = 4_000;
/** An export names a file you may want to open, so it shows longer. */
export const EXPORT_HINT_MS = 8_000;
/** The fewest columns a hint is cut to before it is left out. */
const HINT_MIN = 6;
const GAP = 2;

export function hintFor(text: string, now: number, ms: number = HINT_MS): Hint {
  return { text, until: now + ms };
}

/** `hint` while it still shows at `now`, or null. */
export function liveHint(hint: Hint | null, now: number): Hint | null {
  return hint !== null && hint.until > now ? hint : null;
}

export type BannerRow = { left: string; gap: string; right: string };

/**
 * The banner's row: `left` from the start, `right` at the end. When both do
 * not fit, the hint is cut first, and it is left out below a few columns.
 */
export function bannerRow(left: string | null, right: string | null, columns: number): BannerRow {
  const width = Math.max(0, Math.floor(columns));
  const shown = left === null ? "" : bannerText(left, width);
  if (right === null || right.length === 0) {
    return { left: shown, gap: "", right: "" };
  }
  const room = shown.length === 0 ? width : width - shown.length - GAP;
  if (room < Math.min(HINT_MIN, right.length)) {
    return { left: shown, gap: "", right: "" };
  }
  const hint = bannerText(right, room);
  return { left: shown, gap: " ".repeat(width - shown.length - hint.length), right: hint };
}
