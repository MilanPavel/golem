import type { MemoryItem, MemoryListParams, MemoryListResult, MemorySettings } from "@golem/client";
import { MEMORY_GROUPS, memoryKeyHints, memoryLabel, memoryStateText, memoryUsableNote } from "@golem/view";

import type { Press } from "./keys.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";

/**
 * `/memory`: every stored memory, in tabs You, This project and History, with a word search,
 * edit, delete (after a yes), "in every chat", and an export to a file. The rows are the app's
 * list, read with `memory.list` and read again on `memory.changed` and after a reconnect, so this
 * state only says where the user is. The words come from `@golem/view` (ADR-061, decision 9).
 */
export type MemoryTab = MemoryItem["scope"];

export type MemoryManagerState = {
  open: boolean;
  tab: MemoryTab;
  selected: number;
  /** The word search, committed with Enter. */
  query: string;
  /** The search line takes letters, so they are not shortcuts. */
  typing: boolean;
  /** The id of the memory a `d` is asking about. */
  confirm: string | null;
  /** One line about what the last key did or could not do. */
  message: string | null;
};

/** What `memory.list` returned for this tab and search, or why it could not. */
export type MemoryList = {
  items: readonly MemoryItem[] | null;
  /** The rows the tab and search match, so the screen can say there are more than it holds. */
  total: number;
  counts: MemoryListResult["counts"] | null;
  settings: MemorySettings | null;
  error: string | null;
};

export const emptyMemoryList: MemoryList = { items: null, total: 0, counts: null, settings: null, error: null };

export const closedMemoryManager: MemoryManagerState = {
  open: false,
  tab: "you",
  selected: 0,
  query: "",
  typing: false,
  confirm: null,
  message: null,
};

export type MemoryManagerKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "back"
  | "search"
  | "edit"
  | "delete"
  | "pin"
  | "export"
  | "keep"
  | "yes"
  | "erase"
  | "clear"
  | { text: string };

export type MemoryManagerAction =
  | { kind: "none" }
  | { kind: "close" }
  /** The tab or the search changed: read the list again. */
  | { kind: "reload" }
  /** The cursor ran past the last row and there are more: read the next page after `after`. */
  | { kind: "more"; after: string }
  /** Edit the memory's text in `$EDITOR`, then `memory.update`. */
  | { kind: "edit"; id: string; text: string }
  | { kind: "delete"; id: string }
  /** `memory.update` with `always`. */
  | { kind: "pin"; id: string; always: boolean }
  /** `memory.export` for the tab, written to `file` in the current folder. */
  | { kind: "export"; scope: MemoryTab; file: string };

export type MemoryManagerLine = McpManagerLine;

const TABS: readonly MemoryTab[] = ["you", "project", "history"];
/** One page of the list. The cursor past the last row reads the next one. */
export const MEMORY_PAGE = 50;
const WIDE = 72;
const MAX_TEXT_LINES = 3;
const NO_KEEP = "keeping a proposal is not built yet";

export function openMemoryManager(): MemoryManagerState {
  return { ...closedMemoryManager, open: true };
}

export function memoryManagerTyping(state: MemoryManagerState): boolean {
  return state.typing;
}

export function memoryManagerKeyOf(press: Press, typing = false): MemoryManagerKey | null {
  if (press.name === "return") {
    return "enter";
  }
  if (press.name === "escape") {
    return "back";
  }
  if (typing) {
    if (press.name === "backspace") {
      return "erase";
    }
    if (press.name === "ctrl-u" || press.name === "ctrl-w") {
      return "clear";
    }
    const text = press.input.replace(/[\r\n]/g, "");
    if ((press.name === null || press.name === "question") && !press.ctrl && !press.meta && text.length > 0) {
      return { text };
    }
    return null;
  }
  if (press.name === "up" || press.name === "down" || press.name === "left" || press.name === "right") {
    return press.name;
  }
  if (press.name === "tab") {
    return press.shift === true ? "left" : "right";
  }
  if (press.name !== null || press.ctrl || press.meta) {
    return null;
  }
  const keys: Record<string, MemoryManagerKey> = {
    "/": "search",
    e: "edit",
    d: "delete",
    p: "pin",
    x: "export",
    k: "keep",
    y: "yes",
  };
  return keys[press.input] ?? null;
}

/** The `memory.list` call for a tab and a search. A project tab reads this project's folder. */
export function memoryListParams(state: MemoryManagerState, folder: string | null, after?: string): MemoryListParams {
  const params: MemoryListParams = { scope: state.tab, limit: MEMORY_PAGE };
  if (state.tab === "project" && folder !== null) {
    params.folder = folder;
  }
  if (state.query.trim() !== "") {
    params.query = state.query.trim();
  }
  if (after !== undefined) {
    params.after = after;
  }
  return params;
}

/** The project folder of a session folder (ADR-061 §1): the nearest folder at or above it with `.git` or `.golem`, else itself. */
export function projectFolderOf(
  folder: string,
  exists: (path: string) => boolean,
  real: (path: string) => string = (path) => path,
): string {
  const start = real(folder);
  let current = start;
  for (;;) {
    if (exists(`${current}/.git`) || exists(`${current}/.golem`)) {
      return current;
    }
    const slash = current.lastIndexOf("/");
    if (slash < 0) {
      return start;
    }
    const parent = slash === 0 ? "/" : current.slice(0, slash);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

/** The file `x` writes, in the folder the TUI runs in: `golem-memory-you.md`. */
export function memoryExportFile(scope: MemoryTab): string {
  return `golem-memory-${scope}.md`;
}

/** Whether the daemon said memory is off, so the screen shows that and not a failure. */
export function memoryIsOff(error: string | null): boolean {
  return error !== null && error.includes("memory is off");
}

function moveSelection(index: number, count: number, step: number): number {
  return Math.min(Math.max(index + step, 0), Math.max(0, count - 1));
}

export function pressMemoryManager(
  state: MemoryManagerState,
  list: MemoryList,
  key: MemoryManagerKey,
): { state: MemoryManagerState; action: MemoryManagerAction } {
  const none = (next: MemoryManagerState): { state: MemoryManagerState; action: MemoryManagerAction } => ({
    state: next,
    action: { kind: "none" },
  });
  const items = list.items ?? [];
  const selected = moveSelection(state.selected, items.length, 0);
  const item = items[selected];
  const fresh = { ...state, message: null };

  if (state.confirm !== null) {
    if (key === "yes") {
      return { state: { ...fresh, confirm: null }, action: { kind: "delete", id: state.confirm } };
    }
    return none({ ...fresh, confirm: null });
  }
  if (state.typing) {
    if (key === "enter") {
      return { state: { ...fresh, typing: false, selected: 0 }, action: { kind: "reload" } };
    }
    if (key === "back") {
      const had = state.query !== "";
      return {
        state: { ...fresh, typing: false, query: "", selected: 0 },
        action: had ? { kind: "reload" } : { kind: "none" },
      };
    }
    if (key === "erase") {
      return none({ ...fresh, query: state.query.slice(0, -1) });
    }
    if (key === "clear") {
      return none({ ...fresh, query: "" });
    }
    if (typeof key === "object") {
      return none({ ...fresh, query: state.query + key.text });
    }
    return none(fresh);
  }
  if (key === "back") {
    if (state.query !== "") {
      return { state: { ...fresh, query: "", selected: 0 }, action: { kind: "reload" } };
    }
    return { state: closedMemoryManager, action: { kind: "close" } };
  }
  if (key === "left" || key === "right") {
    const at = TABS.indexOf(state.tab);
    const next = TABS[(at + (key === "left" ? TABS.length - 1 : 1)) % TABS.length] ?? state.tab;
    return { state: { ...fresh, tab: next, selected: 0 }, action: { kind: "reload" } };
  }
  if (key === "up") {
    return none({ ...fresh, selected: moveSelection(selected, items.length, -1) });
  }
  if (key === "down") {
    const last = items[items.length - 1];
    if (selected === items.length - 1 && last !== undefined && list.total > items.length) {
      return { state: { ...fresh, selected }, action: { kind: "more", after: last.id } };
    }
    return none({ ...fresh, selected: moveSelection(selected, items.length, 1) });
  }
  if (key === "search") {
    return none({ ...fresh, typing: true });
  }
  if (key === "keep") {
    return none({ ...fresh, message: item?.state === "proposed" ? NO_KEEP : null });
  }
  if (item === undefined) {
    return none(fresh);
  }
  if (key === "edit") {
    return { state: fresh, action: { kind: "edit", id: item.id, text: item.text } };
  }
  if (key === "delete") {
    return none({ ...fresh, confirm: item.id });
  }
  if (key === "pin") {
    return { state: fresh, action: { kind: "pin", id: item.id, always: item.always !== true } };
  }
  if (key === "export") {
    return { state: fresh, action: { kind: "export", scope: state.tab, file: memoryExportFile(state.tab) } };
  }
  return none(fresh);
}

/** What the editor left: nothing to save, a text to refuse, or the new text (trailing blank lines dropped). */
export function memoryEdited(before: string, after: string): { kind: "same" } | { kind: "empty" } | { kind: "changed"; text: string } {
  const text = after.replace(/\s+$/, "");
  if (text === "") return { kind: "empty" };
  return text === before.replace(/\s+$/, "") ? { kind: "same" } : { kind: "changed", text };
}

/** The state with a line about what happened, for the app to set after an action. */
export function withMemoryMessage(state: MemoryManagerState, message: string | null): MemoryManagerState {
  return { ...state, message };
}

/** The memory a `d` asked about, if it is still in the list. */
export function memoryToDelete(state: MemoryManagerState, list: MemoryList): MemoryItem | null {
  return (list.items ?? []).find((item) => item.id === state.confirm) ?? null;
}

/** ● kept, ◐ may be out of date, ? waiting for you, ○ a local memory no chat can use. */
export function memoryMark(item: MemoryItem): { text: string; tone: McpTone } {
  if (item.state === "proposed") return { text: "?", tone: "wait" };
  if (item.state === "stale") return { text: "◐", tone: "wait" };
  if (item.usable === false) return { text: "○", tone: "off" };
  return { text: "●", tone: "ok" };
}

function scopeSetting(item: MemoryItem, settings: MemorySettings | null): "chat" | "local" {
  if (settings === null) return "chat";
  if (item.scope === "you") return settings.you ?? "chat";
  if (item.scope === "project") return settings.projects ?? "chat";
  return settings.history ?? "chat";
}

/** "used 3 times · may be sent to a paid model: no (this memory is set to local)". */
export function memoryUseLine(item: MemoryItem, settings: MemorySettings | null): string {
  const uses = item.uses ?? 0;
  const used = uses === 0 ? "not used yet" : `used ${uses} ${uses === 1 ? "time" : "times"}`;
  let paid: string;
  if (item.privacy === "local") {
    paid = "no (this memory is set to local)";
  } else if (scopeSetting(item, settings) === "local") {
    paid = `no (${MEMORY_GROUPS[item.scope]} is set to local)`;
  } else {
    paid = "yes, in a chat that is not private";
  }
  return `${used} · may be sent to a paid model: ${paid}`;
}

/** "from app/client.py, jobs/sync.py", or "no source files". */
export function memorySourceLine(item: MemoryItem): string {
  const paths = (item.sources ?? []).map((source) => source.path);
  return paths.length === 0 ? "no source files" : `from ${paths.join(", ")}`;
}

function rightText(item: MemoryItem): string {
  return [memoryLabel(item), memoryStateText(item)].filter((part) => part !== "").join(" · ");
}

function tabLine(state: MemoryManagerState, counts: MemoryList["counts"]): string {
  return TABS.map((tab) => {
    const count = counts === null ? "" : ` ${counts[tab] ?? 0}`;
    const name = `${MEMORY_GROUPS[tab]}${count}`;
    return tab === state.tab ? `[${name}]` : ` ${name} `;
  }).join(" ");
}

function wrap(text: string, width: number, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") out.push(line);
  if (out.length > max) {
    const kept = out.slice(0, max);
    kept[max - 1] = `${kept[max - 1] ?? ""}…`;
    return kept;
  }
  return out;
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function emptyText(state: MemoryManagerState): string[] {
  if (state.query.trim() !== "") {
    return [`No memory in ${MEMORY_GROUPS[state.tab]} matches "${state.query.trim()}".`];
  }
  const how: Record<MemoryTab, string> = {
    you: 'Say "remember that I prefer pnpm" in a chat.',
    project: 'Say "remember that tests run with just test" in a chat.',
    history: "A summary of each session shows up here.",
  };
  return [`Nothing in ${MEMORY_GROUPS[state.tab]} yet.`, how[state.tab]];
}

function detailLines(item: MemoryItem, list: MemoryList, columns: number, wide: boolean): MemoryManagerLine[] {
  const lines: MemoryManagerLine[] = wrap(item.text, Math.max(10, columns - 2), MAX_TEXT_LINES).map((text) => ({ text: `  ${text}` }));
  const facts = [wide ? "" : rightText(item), memorySourceLine(item), memoryUseLine(item, list.settings), memoryUsableNote(item) ?? ""];
  for (const fact of facts.filter((text) => text !== "")) {
    for (const text of wrap(fact, Math.max(10, columns - 2), 2)) {
      lines.push({ text: `  ${text}`, dim: true });
    }
  }
  return lines;
}

function hintLine(state: MemoryManagerState, item: MemoryItem | null, width: number): string {
  if (state.confirm !== null) {
    return "delete? y yes · other key no";
  }
  if (state.typing) {
    return "Enter search · Esc clear";
  }
  const base = memoryKeyHints(item).replace("k keep · ", "");
  const full = item === null ? `←/→ tab · / search · ${base}` : `←/→ tab · / search · p every chat · ${base}`;
  return full.length <= width ? full : base;
}

export function layoutMemoryManager(input: {
  state: MemoryManagerState;
  list: MemoryList;
  /** The project folder, drawn on the project tab. */
  folder: string | null;
  home: string;
  columns: number;
  rows: number;
}): MemoryManagerLine[] {
  const { state, list } = input;
  const width = Math.max(1, input.columns);
  const wide = width >= WIDE;
  const items = list.items ?? [];
  const selected = moveSelection(state.selected, items.length, 0);
  const chosen = items[selected] ?? null;
  const out: MemoryManagerLine[] = [{ text: "Memory", bold: true }];
  const hint: MemoryManagerLine = { text: hintLine(state, chosen, width), dim: true };
  const finish = (lines: MemoryManagerLine[]): MemoryManagerLine[] =>
    lines.slice(0, Math.max(0, input.rows)).map((line) => {
      const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
      return { ...line, text: fit(line.text, Math.max(1, width - used)) };
    });

  if (list.error !== null) {
    out.push({ text: "" }, { text: list.error }, { text: "" }, { text: "esc close", dim: true });
    return finish(out);
  }
  if (list.items === null) {
    out.push({ text: "" }, { text: "asking the daemon…", dim: true }, { text: "" }, { text: "esc close", dim: true });
    return finish(out);
  }

  out.push({ text: tabLine(state, list.counts) });
  if (state.typing || state.query !== "") {
    const found = state.typing ? "" : `  ${list.total} found`;
    out.push({ text: `/ ${state.query}${state.typing ? "▏" : ""}${found}`, dim: !state.typing });
  } else if (state.tab === "project" && input.folder !== null) {
    const shown = input.folder.startsWith(input.home) ? `~${input.folder.slice(input.home.length)}` : input.folder;
    out.push({ text: `Notes about ${shown}`, dim: true });
  }
  out.push({ text: "" });

  if (items.length === 0) {
    for (const text of emptyText(state)) out.push({ text });
    out.push({ text: "" }, hint);
    return finish(out);
  }

  const detail = chosen === null ? [] : detailLines(chosen, list, width, wide);
  const tail: MemoryManagerLine[] = [{ text: "" }, ...detail];
  if (state.confirm !== null || state.message !== null) {
    tail.push({ text: state.confirm !== null ? `delete "${fit(items.find((i) => i.id === state.confirm)?.title ?? "", 60)}"?` : (state.message ?? ""), bold: true });
  }
  tail.push(hint);
  const room = Math.max(1, input.rows - out.length - tail.length);
  const more = list.total > items.length;
  const slots = more ? Math.max(1, room - 1) : room;
  const start = Math.min(Math.max(0, selected - slots + 1), Math.max(0, items.length - slots));
  const rightWidth = wide ? Math.min(Math.max(...items.map((item) => rightText(item).length)), Math.floor(width * 0.45)) : 0;
  const titleWidth = Math.max(8, width - 4 - (wide ? rightWidth + 2 : 0));
  items.slice(start, start + slots).forEach((item, offset) => {
    const index = start + offset;
    const title = fit(item.title, titleWidth);
    const row = wide ? `${title.padEnd(titleWidth)}  ${fit(rightText(item), rightWidth)}` : title;
    out.push({
      prefix: index === selected ? "❯ " : "  ",
      mark: memoryMark(item),
      text: row.trimEnd(),
      selected: index === selected,
    });
  });
  if (more) {
    out.push({ text: `  … ${list.total - items.length} more, keep going down`, dim: true });
  }
  return finish([...out, ...tail]);
}
