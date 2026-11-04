export {
  applySuggestion,
  moveSuggestion,
  suggest,
  type Suggestion,
  type SuggestCommand,
} from "@golem/view";

/** Keeps the selected row on screen. The window is at most `rows` tall. */
export function suggestionWindow(
  count: number,
  selected: number,
  rows: number,
): { start: number; index: number } {
  if (count <= 0 || rows <= 0) {
    return { start: 0, index: 0 };
  }
  const index = Math.max(0, Math.min(selected, count - 1));
  const height = Math.min(rows, count);
  const start = Math.min(count - height, Math.max(0, index - height + 1));
  return { start, index };
}
