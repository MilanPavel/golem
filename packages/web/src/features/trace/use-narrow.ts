import { useSyncExternalStore } from "react";

/** Below this width the trace page is one column and the span opens as a sheet: 760 px. */
const NARROW_QUERY = "(max-width: 760px)";

function subscribe(onChange: () => void): () => void {
  if (typeof globalThis.matchMedia !== "function") return () => {};
  const list = globalThis.matchMedia(NARROW_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return typeof globalThis.matchMedia === "function" && globalThis.matchMedia(NARROW_QUERY).matches;
}

/** True on a narrow window. False where `matchMedia` is missing. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
