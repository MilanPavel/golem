import { RpcError, type MemoryChanged, type MemoryExportParams, type MemoryExportResult, type MemoryItem, type MemoryListResult } from "@golem/client";

export type { MemoryChanged, MemoryExportParams, MemoryExportResult, MemoryItem, MemoryListResult };

export type MemoryScope = MemoryItem["scope"];
export type MemoryPrivacy = NonNullable<MemoryItem["privacy"]>;
export type MemoryCounts = MemoryListResult["counts"];
export type MemorySettings = MemoryListResult["settings"];

/** The query key of `memory.list`. A pushed `memory.changed` and every action below mark it stale. */
export const MEMORY_LIST_KEY = ["memory.list"] as const;

/** One page of a scope's memories, matching `query` when it is not empty. `after` is the id the last page ended on. */
export type MemoryListRequest = { scope: MemoryScope; query: string; after: string | null };

/** How many rows one page holds. */
export const MEMORY_PAGE = 100;

export function memoryListKey(scope: MemoryScope, query: string): readonly unknown[] {
  return [...MEMORY_LIST_KEY, scope, query];
}

/** The key of `[memory]` that holds the privacy of a scope. */
export function memorySettingKey(scope: MemoryScope): "you" | "projects" | "history" {
  return scope === "project" ? "projects" : scope;
}

/** Whether a scope's memories may go to a paid model: the default of `[memory]` is `chat`, which may. */
export function scopeMayGoToPaid(settings: MemorySettings | undefined, scope: MemoryScope): boolean {
  return (settings?.[memorySettingKey(scope)] ?? "chat") === "chat";
}

/** Whether one memory may go to a paid model: its own `privacy` is not `local`. */
export function itemMayGoToPaid(item: MemoryItem): boolean {
  return (item.privacy ?? "chat") === "chat";
}

const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;

/** `[memory] enabled = false`: the daemon has no memory service and says so in every call but `memory.settings`. */
export const MEMORY_OFF_TEXT = "Memory is off. Set enabled = true under [memory] in config.toml to turn it on.";

/** The daemon does not know `memory.list`: it is older than this page. */
export const MEMORY_OLD_TEXT = "This golem is too old for the memory browser. Update golem.";

/** The daemon answered "memory is off". */
export function isMemoryOff(error: unknown): boolean {
  return error instanceof RpcError && error.code === INVALID_PARAMS && error.message.startsWith("memory is off");
}

/** The daemon has no `memory.*` methods. */
export function isMemoryMissing(error: unknown): boolean {
  return error instanceof RpcError && error.code === METHOD_NOT_FOUND;
}

/** One line for a memory call the daemon refused or could not reach. */
export function memoryErrorText(error: unknown, fallback: string): string {
  if (isMemoryOff(error)) return MEMORY_OFF_TEXT;
  if (isMemoryMissing(error)) return MEMORY_OLD_TEXT;
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/** The file name an export is saved under. */
export function memoryExportName(scope: MemoryScope, format: MemoryExportParams["format"]): string {
  return `golem-memory-${scope}.${format === "json" ? "json" : "md"}`;
}
