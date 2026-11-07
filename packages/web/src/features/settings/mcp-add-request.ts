import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/**
 * `/mcp add [id]` in a chat asks the MCP servers section to open its Add dialog. In memory only: the
 * settings route carries no parameters. `id` is a catalog id, `other`, or null for the list.
 */
export type McpAddRequest = { id: string | null };

export const mcpAddRequestStore = createStore<McpAddRequest | null>(null);

export function requestMcpAdd(id: string | null): void {
  mcpAddRequestStore.set({ id });
}

export function useMcpAddRequest(): McpAddRequest | null {
  return useSyncExternalStore(mcpAddRequestStore.subscribe, mcpAddRequestStore.getSnapshot);
}
