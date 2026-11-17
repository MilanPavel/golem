import { useSyncExternalStore } from "react";

/** The layout contract of the side panel: `wide` from 1100 px (--breakpoint-wide), `narrow` below 760 px (--breakpoint-narrow). */
export type LayoutMode = "wide" | "medium" | "narrow";

const WIDE_QUERY = "(min-width: 68.75rem)";
const MEDIUM_QUERY = "(min-width: 47.5rem)";

/** The mode for two query results: does the window reach the wide width, does it reach the narrow one. */
export function layoutMode(wide: boolean, medium: boolean): LayoutMode {
  if (wide) return "wide";
  return medium ? "medium" : "narrow";
}

const available = () => typeof globalThis.matchMedia === "function";

function subscribe(onChange: () => void): () => void {
  if (!available()) return () => {};
  const lists = [globalThis.matchMedia(WIDE_QUERY), globalThis.matchMedia(MEDIUM_QUERY)];
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

// A string snapshot, so React compares by value.
function snapshot(): LayoutMode {
  if (!available()) return "wide";
  return layoutMode(globalThis.matchMedia(WIDE_QUERY).matches, globalThis.matchMedia(MEDIUM_QUERY).matches);
}

/** The layout mode of the window. Without `matchMedia` the layout is `wide`. */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, snapshot, () => "wide");
}
