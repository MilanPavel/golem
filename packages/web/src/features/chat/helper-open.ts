import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/** The helper the drawer shows: the `delegate` call it belongs to, and its own session id. */
export type HelperOpen = { callId: string; helperId: string };

const openStore = createStore<HelperOpen | null>(null);

/** Opens the helper in the drawer beside the chat. Opening another one replaces it. */
export function openHelper(open: HelperOpen): void {
  openStore.set(open);
}

/** Closes the helper panel. The drawer goes back to its tabs. */
export function closeHelper(): void {
  openStore.set(null);
}

/** The helper the drawer shows, or null. */
export function useHelperOpen(): HelperOpen | null {
  return useSyncExternalStore(openStore.subscribe, openStore.getSnapshot);
}
