import type { McpCallResult, McpLogsResult, McpServer, McpServerLog, McpTestProgress, McpTestResult, McpToolsResult } from "@golem/client";

export type { McpCallResult, McpLogsResult, McpServer, McpServerLog, McpTestProgress, McpTestResult, McpToolsResult };

/** The query key of `mcp.tools`. Hiding a tool, and `mcp.server.status`, mark it stale. */
export const MCP_TOOLS_KEY = ["mcp.tools"] as const;

/** The query key of `mcp.list`. The pushed `mcp.server.status` and every action below mark it stale. */
export const MCP_LIST_KEY = ["mcp.list"] as const;

/** The servers a session sees. `null` is no session: the user's own servers only. */
export function mcpListKey(sessionId: string | null): readonly unknown[] {
  return [...MCP_LIST_KEY, sessionId];
}

/** The tools of one server, as a session sees it. */
export function mcpToolsKey(name: string, sessionId: string | null): readonly unknown[] {
  return [...MCP_TOOLS_KEY, name, sessionId];
}
