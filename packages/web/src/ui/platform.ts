type WithUserAgentData = Navigator & { userAgentData?: { platform?: string } };

/** The page runs on macOS (or iOS), where the command key is ⌘ and not Ctrl. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as WithUserAgentData).userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The key that goes with a letter for a page shortcut, as shown: `⌘K` on macOS, `Ctrl K` elsewhere. */
export function modShortcut(letter: string): string {
  return isMac() ? `⌘${letter}` : `Ctrl ${letter}`;
}

/** Whether the event holds the page's command key: ⌘ on macOS, Ctrl elsewhere. */
export function hasMod(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac() ? event.metaKey : event.ctrlKey;
}
