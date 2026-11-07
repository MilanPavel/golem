/** Puts text on the clipboard. Rejects when the browser has none or refuses. */
export async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("The clipboard is not available in this page.");
  }
  await navigator.clipboard.writeText(text);
}
