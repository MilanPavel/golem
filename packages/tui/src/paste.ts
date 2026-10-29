import type { Draft } from "./edit.ts";

/**
 * Long pastes in the composer. A paste of many lines or characters goes into
 * the draft as one short token, such as `[Pasted text #1 +8 lines]`, and the
 * full text comes back when the draft is sent or opened in the editor. Only
 * the exact token expands, so a token you type inside stays plain text.
 */

/** A paste of this many lines or more becomes a token. */
export const PASTE_LINES = 3;
/** A paste of this many characters or more becomes a token. */
export const PASTE_CHARS = 800;

/** The pastes behind the tokens, by token, and the number the next one gets. */
export type Pastes = { next: number; texts: ReadonlyMap<string, string> };

export const noPastes: Pastes = { next: 1, texts: new Map() };

/** `text` with the line endings a terminal paste may carry turned into `\n`. */
export function pasteText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function collapses(text: string): boolean {
  return text.split("\n").length >= PASTE_LINES || [...text].length >= PASTE_CHARS;
}

/** `[Pasted text #N +M lines]`, M being the lines after the first, or `#N 1,234 chars` for one line. */
export function pasteToken(number: number, text: string): string {
  const extra = text.split("\n").length - 1;
  if (extra === 0) {
    return `[Pasted text #${number} ${[...text].length.toLocaleString("en-US")} chars]`;
  }
  return `[Pasted text #${number} +${extra} ${extra === 1 ? "line" : "lines"}]`;
}

/** What a paste puts in the draft: its text, or a token for a long one. */
export function collapsePaste(pastes: Pastes, raw: string): { pastes: Pastes; insert: string } {
  const text = pasteText(raw);
  if (!collapses(text)) {
    return { pastes, insert: text };
  }
  const token = pasteToken(pastes.next, text);
  const texts = new Map(pastes.texts);
  texts.set(token, text);
  return { pastes: { next: pastes.next + 1, texts }, insert: token };
}

/** `text` with each token swapped back for the paste behind it. */
export function expandPastes(text: string, pastes: Pastes): string {
  let expanded = text;
  for (const [token, paste] of pastes.texts) {
    expanded = expanded.split(token).join(paste);
  }
  return expanded;
}

/** Backspace right after a token removes all of it, or null when the cursor is not after one. */
export function deleteToken(draft: Draft, pastes: Pastes): Draft | null {
  const before = draft.text.slice(0, draft.cursor);
  for (const token of pastes.texts.keys()) {
    if (before.endsWith(token)) {
      const at = draft.cursor - token.length;
      return { text: draft.text.slice(0, at) + draft.text.slice(draft.cursor), cursor: at };
    }
  }
  return null;
}
