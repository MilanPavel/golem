import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";
import type { ModelDialogViewProps } from "./model-dialog.tsx";

/**
 * The model dialog of one session, open or not. The chip and the `/model` command both open it
 * here, so one dialog serves both. `returnTo` says where focus goes back to when it closes: the
 * chip, or the element that had focus when the command ran, which is the composer.
 */
export type ModelDialogOpen = {
  sessionId: string;
  returnTo: "chip" | HTMLElement | null;
  initial?: ModelDialogViewProps["initial"];
};

export const modelDialogStore = createStore<ModelDialogOpen | null>(null);

export function openModelDialog(open: ModelDialogOpen): void {
  modelDialogStore.set(open);
}

export function closeModelDialog(): void {
  modelDialogStore.set(null);
}

/** The open dialog for this session, or null when it is closed or open for another session. */
export function useModelDialogOpen(sessionId: string): ModelDialogOpen | null {
  const state = useSyncExternalStore(modelDialogStore.subscribe, modelDialogStore.getSnapshot);
  return state !== null && state.sessionId === sessionId ? state : null;
}
