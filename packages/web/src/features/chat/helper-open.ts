import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/**
 * The helper the drawer shows: its own session id, and the `delegate` call it belongs to. The sidebar
 * knows no call id, so `callId` may be left out: the panel finds the call in the lead's log. `leadId` says
 * which chat the helper belongs to when it is opened from outside that chat (the sidebar card): the
 * chat that is open keeps it, any other chat closes it.
 */
export type HelperOpen = { helperId: string; callId?: string; leadId?: string };

const openStore = createStore<HelperOpen | null>(null);

/** Opens the helper in the drawer beside the chat. Opening another one replaces it. */
export function openHelper(open: HelperOpen): void {
  openStore.set(open);
}

/** Closes the helper panel. The drawer goes back to its tabs. */
export function closeHelper(): void {
  openStore.set(null);
}

/**
 * Closes the helper panel unless it was opened for a chat other than `chatId`: leaving a chat closes its
 * helper, but a helper opened from the sidebar for the chat that is about to show survives the switch.
 */
export function closeHelperOf(chatId: string): void {
  const open = openStore.getSnapshot();
  if (open !== null && open.leadId !== undefined && open.leadId !== chatId) return;
  openStore.set(null);
}

/** Closes the helper panel when it belongs to another chat than `chatId`. */
export function closeHelperNotOf(chatId: string): void {
  const open = openStore.getSnapshot();
  if (open !== null && open.leadId !== undefined && open.leadId !== chatId) openStore.set(null);
}

/** The helper the drawer shows, or null. */
export function useHelperOpen(): HelperOpen | null {
  return useSyncExternalStore(openStore.subscribe, openStore.getSnapshot);
}
