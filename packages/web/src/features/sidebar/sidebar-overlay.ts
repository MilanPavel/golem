import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/**
 * Whether the panel floats over the page (below 1100 px). It is not kept: the page opens with the panel
 * closed, and the wide layout's stored open state does not touch it.
 */
export const sidebarOverlayStore = createStore<boolean>(false);

export function useSidebarOverlay(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(sidebarOverlayStore.subscribe, sidebarOverlayStore.getSnapshot);
  return [open, sidebarOverlayStore.set];
}
