import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/** The line a start that chose a model for the person leaves under the composer, until they type. */
export const startNoticeStore = createStore<string | null>(null);

export function useStartNotice(): string | null {
  return useSyncExternalStore(startNoticeStore.subscribe, startNoticeStore.getSnapshot);
}
