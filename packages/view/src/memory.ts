import type { MemoryItem } from "@golem/client";

/** What `/memory` and the Memory page say about a memory, as words and data: the TUI lays it out, the page draws it. */

/** The group titles, by scope. */
export const MEMORY_GROUPS = { you: "You", project: "This project", history: "History" } as const;

const SCOPES = ["you", "project", "history"] as const;

export type MemoryGroup = {
  scope: MemoryItem["scope"];
  title: string;
  items: MemoryItem[];
};

/** The rows by scope, in the order you, project, history. A scope with no rows is left out. */
export function groupMemories(items: readonly MemoryItem[]): MemoryGroup[] {
  return SCOPES.map((scope) => ({
    scope,
    title: MEMORY_GROUPS[scope],
    items: items.filter((item) => item.scope === scope),
  })).filter((group) => group.items.length > 0);
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** Who wrote a memory and why it is trusted: "you said", "an explorer · 3 files", "golem proposed · you kept". */
export function memoryLabel(item: MemoryItem): string {
  if (item.author === "you") {
    return "you said";
  }
  const parts: string[] = [];
  if (item.author === "helper") {
    const agent = item.agent ?? "helper";
    parts.push(`${article(agent)} ${agent}`);
    const count = (item.sources ?? []).length;
    if (count > 0) {
      parts.push(`${count} ${count === 1 ? "file" : "files"}`);
    }
  } else {
    parts.push("golem proposed");
  }
  if (item.kept_by === "you") {
    parts.push("you kept");
  } else if (item.kept_by === "auto") {
    parts.push("kept automatically");
  }
  return parts.join(" · ");
}

/** The state of a memory in words, joined with a dot. Empty for a kept memory with nothing to say. */
export function memoryStateText(item: MemoryItem): string {
  const parts: string[] = [];
  if (item.state === "proposed") {
    parts.push("waiting for you");
  }
  if (item.state === "stale") {
    parts.push("may be out of date");
  }
  if (item.always) {
    parts.push("in every chat");
  }
  if (item.privacy === "local") {
    parts.push("local models only");
  }
  return parts.join(" · ");
}

/** A note for a `local` memory that no chat can use now, because no local model is set up. Else null. */
export function memoryUsableNote(item: MemoryItem): string | null {
  if (item.privacy === "local" && item.usable === false) {
    return "not used: no local model is set up";
  }
  return null;
}

/** The keys for a row. A proposal is kept or dropped, every other row is edited. */
export function memoryKeyHints(item: MemoryItem | null): string {
  if (item === null) {
    return "esc close";
  }
  if (item.state === "proposed") {
    return "k keep · e edit · d delete · esc close";
  }
  return "e edit · d delete · x export · esc close";
}
