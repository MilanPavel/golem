import type { Draft } from "./edit.ts";
import type { Pastes } from "@golem/view";

export {
  collapsePaste,
  collapses,
  expandPastes,
  noPastes,
  PASTE_CHARS,
  PASTE_LINES,
  pasteText,
  pasteToken,
  type Pastes,
} from "@golem/view";

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
