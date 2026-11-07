import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";
import type { ModelDialogViewProps } from "./model-dialog.tsx";

/**
 * The model dialog of one session, open or not. The chip and the `/model` command both open it
 * here, so one dialog serves both. `returnTo` says where focus goes back to when it closes: the
 * chip, or the element that had focus when the command ran, which is the composer.
 */
export type ModelDialogOpen = {
  /** The session it is for, or null for the model of the next new session (new-session mode). */
  sessionId: string | null;
  /** "default" is for the default model of new sessions: Settings opens it. It has no session, so `sessionId` is null. */
  mode?: "default";
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

/** The open dialog for this session (null: for none), or null when it is closed or open for another. */
export function useModelDialogOpen(sessionId: string | null): ModelDialogOpen | null {
  const state = useSyncExternalStore(modelDialogStore.subscribe, modelDialogStore.getSnapshot);
  return state !== null && state.sessionId === sessionId ? state : null;
}
