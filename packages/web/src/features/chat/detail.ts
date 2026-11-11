import { isDetail, type Detail } from "@golem/view";
import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const DETAIL_KEY = "golem.detail";

/** The stored choice; with none, or a word that is not one, Normal (also when storage is missing or blocked). */
export function readDetail(): Detail {
  try {
    const stored = globalThis.localStorage.getItem(DETAIL_KEY);
    return isDetail(stored) ? stored : "normal";
  } catch {
    return "normal";
  }
}

function writeDetail(detail: Detail): void {
  try {
    globalThis.localStorage.setItem(DETAIL_KEY, detail);
  } catch {
    // The choice then lasts until the page closes.
  }
}

/** One choice for every turn in the page: how much of the tool steps shows. */
export const detailStore = createStore<Detail>(readDetail());

export function setDetail(detail: Detail): void {
  detailStore.set(detail);
  writeDetail(detail);
}

export function useDetail(): Detail {
  return useSyncExternalStore(detailStore.subscribe, detailStore.getSnapshot);
}
