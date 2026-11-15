import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/**
 * "New skill…" in the command palette asks the Skills section to open its New skill dialog. In memory
 * only, and read once: the section takes the request when it opens the dialog.
 */
export const newSkillRequestStore = createStore<boolean>(false);

export function requestNewSkill(): void {
  newSkillRequestStore.set(true);
}

export function useNewSkillRequest(): boolean {
  return useSyncExternalStore(newSkillRequestStore.subscribe, newSkillRequestStore.getSnapshot);
}
