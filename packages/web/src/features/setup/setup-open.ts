import type { SetupWindow } from "@golem/view";
import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/**
 * The setup window of the page, open or not. The `/setup` command, the palette, a send with no
 * model, and the page's start all open it here, so one dialog serves them. `returnTo` is where
 * focus goes back to when it closes: the element that had focus when it opened.
 */
export type SetupOpen = { id: number; window: SetupWindow; returnTo: HTMLElement | null };

export const setupStore = createStore<SetupOpen | null>(null);

let opened = 0;

/** Opens a new window. Each opening has its own `id`, so it starts from fresh state. */
export function openSetup(open: { window: SetupWindow; returnTo?: HTMLElement | null }): void {
  opened += 1;
  setupStore.set({ id: opened, window: open.window, returnTo: open.returnTo ?? null });
}

export function closeSetup(): void {
  setupStore.set(null);
}

export function useSetupOpen(): SetupOpen | null {
  return useSyncExternalStore(setupStore.subscribe, setupStore.getSnapshot);
}
