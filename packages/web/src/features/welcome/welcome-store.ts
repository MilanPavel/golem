import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";
import type { WelcomeStep } from "./welcome-steps.ts";

/**
 * What the welcome page leaves behind when it is closed: where `Later` was pressed, so `Finish
 * setup` comes back to that step, and the download that becomes the default when it ends. It
 * lives apart from the page, which unmounts when the route changes.
 */
export type WelcomeProgress = {
  leftAt: WelcomeStep | null;
  /** A model's download, and its name as `setDefault` takes it, that the page was told to wait for. */
  pending: { ref: string; name: string } | null;
  /** Bytes a second of the last download that was measured, for the time estimates of the Model step. */
  speed: number | null;
};

const IDLE: WelcomeProgress = { leftAt: null, pending: null, speed: null };

export const welcomeStore = createStore<WelcomeProgress>(IDLE);

export function useWelcomeProgress(): WelcomeProgress {
  return useSyncExternalStore(welcomeStore.subscribe, welcomeStore.getSnapshot);
}

/** `Later` was pressed at `step`. */
export function leaveWelcome(step: WelcomeStep): void {
  welcomeStore.set({ ...welcomeStore.getSnapshot(), leftAt: step });
}

/** Setup is over, or has its own way back: no strip on home. */
export function finishWelcome(): void {
  welcomeStore.set({ ...welcomeStore.getSnapshot(), leftAt: null });
}

export function setPendingModel(pending: WelcomeProgress["pending"]): void {
  welcomeStore.set({ ...welcomeStore.getSnapshot(), pending });
}

export function setPullSpeed(speed: number): void {
  const snapshot = welcomeStore.getSnapshot();
  if (snapshot.speed !== speed) welcomeStore.set({ ...snapshot, speed });
}

/** Back to a page load's start. For tests. */
export function resetWelcome(): void {
  welcomeStore.set(IDLE);
}
