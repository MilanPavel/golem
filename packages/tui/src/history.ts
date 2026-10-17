import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Oldest lines fall off after this many. */
export const HISTORY_LIMIT = 1000;

export type HistoryCursor = {
  /** The draft from before Up, put back by Esc or by Down past the newest entry. */
  saved: string;
  /** 0 is the newest recalled message. */
  index: number;
};

export type HistoryStore = {
  /** Newest last. Empty until `load` finishes, plus anything remembered before that. */
  snapshot(): readonly string[];
  load(): Promise<void>;
  remember(text: string): void;
  /** Resolves when a remembered line has reached the file. */
  settled(): Promise<void>;
};

type RecallMessage = {
  role: string;
  text: string;
};

/** `GOLEM_HOME` when it is set, otherwise `~/.golem`, then `history`. */
export function historyPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const fromEnv = env["GOLEM_HOME"]?.trim() ?? "";
  const root = fromEnv.length > 0 ? expandHome(fromEnv, home) : join(home, ".golem");
  return join(root, "history");
}

/** User lines in the order they were sent. */
export function sessionEntries(messages: readonly RecallMessage[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "user" && message.text.length > 0) {
      lines.push(message.text);
    }
  }
  return lines;
}

/**
 * Newest first. This session's messages come before the file, and a line that
 * is already in the session is not repeated from the file.
 */
export function recallOrder(sessionOldestFirst: readonly string[], fileOldestFirst: readonly string[]): string[] {
  const session = [...sessionOldestFirst].reverse();
  const seen = new Set(session);
  const older: string[] = [];
  for (let index = fileOldestFirst.length - 1; index >= 0; index -= 1) {
    const line = fileOldestFirst[index];
    if (line === undefined || seen.has(line)) {
      continue;
    }
    seen.add(line);
    older.push(line);
  }
  return [...session, ...older];
}

/**
 * Up moves toward older entries. Down moves back, and past the newest entry
 * restores `saved`. The entry list is not changed, so an edit of the draft stays on screen only.
 */
export function browseHistory(
  cursor: HistoryCursor | null,
  direction: "older" | "newer",
  entriesNewestFirst: readonly string[],
  draft: string,
): { cursor: HistoryCursor | null; text: string } {
  if (direction === "newer") {
    if (cursor === null) {
      return { cursor: null, text: draft };
    }
    if (cursor.index <= 0) {
      return { cursor: null, text: cursor.saved };
    }
    const text = entriesNewestFirst[cursor.index - 1] ?? cursor.saved;
    return { cursor: { saved: cursor.saved, index: cursor.index - 1 }, text };
  }
  const start = cursor ?? { saved: draft, index: -1 };
  const next = start.index + 1;
  if (next >= entriesNewestFirst.length) {
    return { cursor: start.index === -1 ? null : start, text: draft };
  }
  const text = entriesNewestFirst[next] ?? draft;
  return { cursor: { saved: start.saved, index: next }, text };
}

export function leaveHistory(cursor: HistoryCursor | null, draft: string): { cursor: null; text: string } {
  if (cursor === null) {
    return { cursor: null, text: draft };
  }
  return { cursor: null, text: cursor.saved };
}

/** Adds one sent line. An empty line and a repeat of the latest line are left out. */
export function appendHistory(existing: readonly string[], text: string): readonly string[] {
  if (text.length === 0 || existing[existing.length - 1] === text) {
    return existing;
  }
  if (existing.length >= HISTORY_LIMIT) {
    return [...existing.slice(existing.length - HISTORY_LIMIT + 1), text];
  }
  return [...existing, text];
}

export function decodeHistory(raw: string): string[] {
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "string" && value.length > 0) {
        lines.push(value);
      }
    } catch {
      // A torn write leaves one bad line. The rest of the file still recalls.
    }
  }
  return lines;
}

export function encodeHistory(lines: readonly string[]): string {
  if (lines.length === 0) {
    return "";
  }
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

export function createHistory(file: string): HistoryStore {
  let entries: string[] = [];
  let queued: string[] = [];
  let loaded = false;
  let loading: Promise<void> | null = null;
  let writing: Promise<void> = Promise.resolve();

  const persist = (): void => {
    const lines = entries;
    writing = writing.then(() => writeHistoryFile(file, lines)).catch(() => undefined);
  };

  const load = (): Promise<void> => {
    if (loaded) {
      return Promise.resolve();
    }
    if (loading === null) {
      loading = readHistoryFile(file)
        .then((found) => {
          entries = appendAll(found, queued);
          const dirty = queued.length > 0;
          queued = [];
          loaded = true;
          if (dirty) {
            persist();
          }
        })
        .catch((error: unknown) => {
          loading = null;
          throw error;
        });
    }
    return loading;
  };

  return {
    snapshot() {
      return loaded ? entries : queued;
    },
    load,
    remember(text) {
      if (text.length === 0) {
        return;
      }
      if (!loaded) {
        queued = [...appendHistory(queued, text)];
        void load().catch(() => undefined);
        return;
      }
      const next = appendHistory(entries, text);
      if (next === entries) {
        return;
      }
      entries = [...next];
      persist();
    },
    settled() {
      return load().then(() => writing);
    },
  };
}

function appendAll(base: readonly string[], extra: readonly string[]): string[] {
  let next: readonly string[] = base;
  for (const text of extra) {
    next = appendHistory(next, text);
  }
  return [...next];
}

async function readHistoryFile(file: string): Promise<string[]> {
  try {
    return decodeHistory(await readFile(file, "utf8"));
  } catch (error: unknown) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
}

async function writeHistoryFile(file: string, lines: readonly string[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, encodeHistory(lines), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

function expandHome(input: string, home: string): string {
  if (input === "~") {
    return home;
  }
  if (input.startsWith("~/")) {
    return join(home, input.slice(2));
  }
  return input;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
