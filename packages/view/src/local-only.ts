/** The tag of a chat whose folder stays on this Mac: only a local model reads it. */
export const LOCAL_ONLY_LABEL = "local only";

/** What the tag means, for a tooltip. The same words in the web and the terminal. */
export const LOCAL_ONLY_HINT = "This folder stays on this Mac: only a local model reads the chat.";

/** `local only` for a session summary whose folder stays on this Mac, else "". */
export function localOnlyLabel(summary: { local_only?: boolean } | null | undefined): string {
  return summary?.local_only === true ? LOCAL_ONLY_LABEL : "";
}
