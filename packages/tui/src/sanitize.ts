/**
 * Text from files, commands, and web pages can hold terminal escapes. Shown raw,
 * they move the cursor, recolour the screen, or set the clipboard.
 */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Every control character except tab and newline as a visible mark: `␛` for an escape, `�` for the rest. */
export function visibleText(text: string): string {
  return text.replace(CONTROL, (char) => (char === "\u001b" ? "␛" : "�"));
}
