import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/**
 * Another page can ask the MCP servers section to open one server's details. In memory only: the
 * settings route carries no parameters. `name` is the server's name; the section takes the request once it has shown it.
 */
export type McpOpenRequest = { name: string };

export const mcpOpenRequestStore = createStore<McpOpenRequest | null>(null);

export function requestMcpOpen(name: string): void {
  mcpOpenRequestStore.set({ name });
}

export function useMcpOpenRequest(): McpOpenRequest | null {
  return useSyncExternalStore(mcpOpenRequestStore.subscribe, mcpOpenRequestStore.getSnapshot);
}
