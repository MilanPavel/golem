/** The sent texts are kept under this key, newest last. */
export const HISTORY_KEY = "golem.history";
/** Older texts fall off after this many. */
export const HISTORY_LIMIT = 100;

export type HistoryStorage = Pick<Storage, "getItem" | "setItem">;

export type History = {
  /** Oldest first, newest last. */
  entries(): string[];
  /** Remember a sent text (already expanded). The same text twice in a row is kept once. */
  add(text: string): void;
};

/**
 * The texts sent from the composer. Storage is read on each call and may be missing or fail
 * (a private window, blocked site data): history then lasts only until the page closes.
 */
export function createHistory(getStorage: () => HistoryStorage | null): History {
  let memory: string[] = [];
  let trusted = false;

  function storage(): HistoryStorage | null {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  function read(): string[] {
    try {
      const raw = storage()?.getItem(HISTORY_KEY) ?? null;
      if (raw === null && trusted) {
        memory = [];
      }
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          memory = parsed.filter((item): item is string => typeof item === "string").slice(-HISTORY_LIMIT);
        }
      }
    } catch {
      // keep what is in memory
    }
    return memory;
  }

  return {
    entries: () => [...read()],
    add(text) {
      if (text.trim() === "") {
        return;
      }
      const entries = read();
      if (entries[entries.length - 1] === text) {
        return;
      }
      memory = [...entries, text].slice(-HISTORY_LIMIT);
      try {
        const target = storage();
        target?.setItem(HISTORY_KEY, JSON.stringify(memory));
        trusted = target !== null;
      } catch {
        // full or blocked: memory still has it
      }
    },
  };
}

/** The browser's `localStorage`, or null when the browser denies it. */
export function browserStorage(): HistoryStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const browserHistory: History = createHistory(browserStorage);

/** Where Up and Down have taken the draft: the entry shown, and the draft to come back to. */
export type Recall = { index: number; saved: string };

/** One step through the entries (oldest first). Null when there is nowhere to go. */
export function recall(
  entries: readonly string[],
  at: Recall | null,
  direction: "older" | "newer",
  draft: string,
): { at: Recall | null; text: string } | null {
  if (direction === "older") {
    const index = at === null ? entries.length - 1 : at.index - 1;
    const text = entries[index];
    return text === undefined ? null : { at: { index, saved: at?.saved ?? draft }, text };
  }
  if (at === null) {
    return null;
  }
  const text = entries[at.index + 1];
  return text === undefined ? { at: null, text: at.saved } : { at: { ...at, index: at.index + 1 }, text };
}
