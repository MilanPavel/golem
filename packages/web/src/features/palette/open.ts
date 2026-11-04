import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/**
 * Which of the palette's two dialogs is open. `returnTo` is where focus goes back to when it
 * closes: what had focus when it opened.
 */
export type PaletteOpen = { dialog: "palette" | "keys"; returnTo: HTMLElement | null };

export const paletteStore = createStore<PaletteOpen | null>(null);

function focused(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
}

export function openPalette(returnTo: HTMLElement | null = focused()): void {
  paletteStore.set({ dialog: "palette", returnTo });
}

export function openKeys(returnTo: HTMLElement | null = focused()): void {
  paletteStore.set({ dialog: "keys", returnTo });
}

export function closePalette(): void {
  paletteStore.set(null);
}

export function usePaletteOpen(): PaletteOpen | null {
  return useSyncExternalStore(paletteStore.subscribe, paletteStore.getSnapshot);
}
