import { createStore } from "../../store/create-store.ts";

/**
 * `/config [project]` in a chat asks the Config file section to open on the user's file or the
 * project's. In memory only: the settings route carries no parameters.
 */
export type ConfigRequest = { project: boolean };

export const configRequestStore = createStore<ConfigRequest | null>(null);

export function requestConfig(project: boolean): void {
  configRequestStore.set({ project });
}
