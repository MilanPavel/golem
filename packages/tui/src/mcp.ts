import type { McpServer } from "@golem/client";

import { fitLine } from "./commands.ts";

/** What `/mcp` shows: the servers once `mcp.list` answers, or why it did not. */
export type McpPanel = { servers: readonly McpServer[] | null; error: string | null };

export const MCP_HINT = "Add one to ~/.golem/config.toml as [mcp.<name>] with a command, then golem daemon restart.";

/** One row per server: name, state, then its tool count or why it failed. */
export function mcpLines(panel: McpPanel, columns: number): string[] {
  if (panel.error !== null) {
    return [fitLine(`MCP servers: ${panel.error}`, columns)];
  }
  if (panel.servers === null) {
    return [fitLine("MCP servers: asking the daemon…", columns)];
  }
  if (panel.servers.length === 0) {
    return [fitLine("No MCP servers.", columns), fitLine(MCP_HINT, columns)];
  }
  const nameWidth = Math.max(...panel.servers.map((server) => server.name.length));
  const stateWidth = Math.max(...panel.servers.map((server) => server.state.length));
  return panel.servers.map((server) =>
    fitLine(`${server.name.padEnd(nameWidth)}  ${server.state.padEnd(stateWidth)}  ${detail(server)}`, columns),
  );
}

/** `servers` with `changed` in place of the server of the same name. */
export function mergeMcp(servers: readonly McpServer[], changed: McpServer): McpServer[] {
  const found = servers.some((server) => server.name === changed.name);
  return found ? servers.map((server) => (server.name === changed.name ? changed : server)) : [...servers, changed];
}

function detail(server: McpServer): string {
  if (server.state === "running") {
    const count = server.tools?.length ?? 0;
    return `${count} ${count === 1 ? "tool" : "tools"} · ${server.command}`;
  }
  if (server.state === "failed") {
    return server.error ?? "failed";
  }
  return server.command;
}
