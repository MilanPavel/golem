/** Puts text on the clipboard. Rejects when the browser has none or refuses. */
export async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("The clipboard is not available in this page.");
  }
  await navigator.clipboard.writeText(text);
}

/** Saves text as a file through the browser's downloads, with no server in between. */
export function downloadText(fileName: string, text: string, type = "text/markdown"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has started the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
