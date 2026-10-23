import type { McpServer } from "@golem/client";

/** The session's MCP servers once `mcp.list` answers, or why it did not. `/mcp` and the status line read it. */
export type McpList = { servers: readonly McpServer[] | null; error: string | null };

/**
 * `servers` with `changed` in place of the server it reports on. A status
 * from the broadcast does not say whether this session has the server on, so
 * that is kept, and a server this session does not list is left out.
 */
export function mergeMcp(servers: readonly McpServer[], changed: McpServer): McpServer[] {
  return servers.map((server) =>
    server.name === changed.name && (server.project ?? null) === (changed.project ?? null)
      ? { ...changed, enabled: server.enabled }
      : server,
  );
}

/** For the status line: the servers this session uses that are down, or "". */
export function mcpAlert(servers: readonly McpServer[] | null): string {
  const down = (servers ?? []).filter((server) => server.enabled === true && server.state === "failed");
  return down.length === 0 ? "" : `mcp ✗ ${down.map((server) => server.name).join(", ")}`;
}
