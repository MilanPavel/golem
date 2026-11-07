import type { McpListResult } from "../../protocol/gen/mcp-list-result.ts";
import type { McpServerDetail } from "../../protocol/gen/mcp-server-detail.ts";
import type { McpToolsResult } from "../../protocol/gen/mcp-tools-result.ts";

import { ownToolName } from "@golem/view";

export { changeToolFilter, formatLogLine, formatTestResult, formatTestStep, ownToolName, type ToolsChange } from "@golem/view";

type Server = McpListResult["servers"][number];

function table(rows: readonly (readonly string[])[]): string {
  const widths = rows.reduce<number[]>((max, row) => row.map((cell, index) => Math.max(max[index] ?? 0, cell.length)), []);
  return rows
    .map((row) => row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join("  ").trimEnd())
    .join("\n");
}

/** What a list row says besides the state: how the server is turned on, and what limits it. */
export function serverMarks(server: Server): string[] {
  const marks: string[] = [];
  if (server.on_demand) marks.push("on demand");
  if ((server.tools_hidden ?? 0) > 0) marks.push(`hidden ${server.tools_hidden} tools`);
  if (server.approval === "allow") marks.push("allow");
  if (server.error !== undefined && server.error !== null) marks.push(server.error);
  return marks;
}

/** One row per server: name, state, tool count, token cost, and marks. */
export function formatMcpList(servers: readonly Server[]): string {
  if (servers.length === 0) return "no MCP servers. Add one with: golem mcp add --catalog <id>";
  const rows = [["NAME", "STATE", "TOOLS", "TOKENS", "NOTES"]];
  for (const server of servers) {
    rows.push([
      server.name,
      server.state,
      String(server.tools?.length ?? 0),
      server.schema_tokens === undefined || server.schema_tokens === null ? "-" : String(server.schema_tokens),
      serverMarks(server).join(", "),
    ]);
  }
  return table(rows);
}

function entries(values: Record<string, string> | undefined): string[] {
  return Object.entries(values ?? {}).map(([key, value]) => `  ${key} = ${value}`);
}

/** One server's whole setup. A secret is named and marked stored or not, never shown. */
export function formatMcpDetail(detail: McpServerDetail): string {
  const { server, config } = detail;
  const lines = [`${server.name}  ${server.state}${server.error ? `  ${server.error}` : ""}`];
  lines.push(`  in ${detail.path} (${detail.scope})`);
  if (config.url !== undefined && config.url !== null) {
    lines.push(`  url ${config.url}`);
  } else {
    lines.push(`  command ${[config.command ?? "", ...(config.args ?? [])].join(" ")}`);
    if (config.cwd) lines.push(`  cwd ${config.cwd}`);
  }
  const env = entries(config.env);
  if (env.length > 0) lines.push("  env", ...env.map((line) => `  ${line}`));
  const headers = entries(config.headers);
  if (headers.length > 0) lines.push("  headers", ...headers.map((line) => `  ${line}`));
  if ((config.env_passthrough ?? []).length > 0) lines.push(`  passes through ${(config.env_passthrough ?? []).join(", ")}`);
  const enabled = config.enabled === "on_demand" ? "on demand" : config.enabled === false ? "off" : "on";
  lines.push(`  ${enabled} · ${config.timeout_seconds ?? 120}s per call · approval ${config.approval ?? "ask"}`);
  const { include = [], exclude = [] } = config.tools ?? {};
  if (include.length > 0) lines.push(`  tools only ${include.join(", ")}`);
  if (exclude.length > 0) lines.push(`  tools hidden ${exclude.join(", ")}`);
  for (const secret of detail.secrets) {
    lines.push(`  secret ${secret.ref}: ${secret.stored ? "stored" : `not stored: golem auth set ${secret.ref}`}`);
  }
  return lines.join("\n");
}

export function formatMcpTools(result: McpToolsResult): string {
  if (result.tools.length === 0) return `${result.name} has no tools right now: it is not running`;
  const rows = [["TOOL", "TOKENS", "NOTES"]];
  for (const tool of result.tools) {
    rows.push([ownToolName(result.name, tool.name), String(tool.schema_tokens ?? 0), tool.hidden ? "hidden" : ""]);
  }
  return table(rows);
}
