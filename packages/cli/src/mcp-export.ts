import type { McpServerConfig, McpServerDetail } from "../../protocol/gen/mcp-server-detail.ts";

export type ExportFormat = "claude" | "vscode";

const KEYCHAIN = /keychain:mcp\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/** The environment variable that stands for the Keychain secret `mcp/<rest>`: `mcp/my-tool` is `MCP_MY_TOOL`. */
export function secretVariable(rest: string): string {
  return `MCP_${rest.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** The text of an `env` or `headers` value, with each `keychain:mcp/x` reference as a variable of the other app. */
function reference(text: string, format: ExportFormat, used: Map<string, string>): string {
  return text.replace(KEYCHAIN, (_whole, rest: string) => {
    const variable = secretVariable(rest);
    used.set(variable, `mcp/${rest}`);
    return format === "vscode" ? `\${env:${variable}}` : `\${${variable}}`;
  });
}

function mapped(table: Record<string, string>, format: ExportFormat, used: Map<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(table).map(([key, value]) => [key, reference(value, format, used)]));
}

function entry(config: McpServerConfig, format: ExportFormat, used: Map<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (config.url !== undefined && config.url !== null) {
    out["type"] = "http";
    out["url"] = config.url;
    if (config.headers !== undefined && Object.keys(config.headers).length > 0) {
      out["headers"] = mapped(config.headers, format, used);
    }
  } else {
    if (format === "vscode") out["type"] = "stdio";
    out["command"] = config.command;
    if (config.args !== undefined && config.args.length > 0) out["args"] = config.args;
    if (config.env !== undefined && Object.keys(config.env).length > 0) out["env"] = mapped(config.env, format, used);
    if (config.cwd !== undefined && config.cwd !== null) out["cwd"] = config.cwd;
  }
  if (format === "claude" && config.enabled === false) out["disabled"] = true;
  return out;
}

export interface McpExport {
  /** The JSON to print. It holds variable names, never a secret value. */
  json: string;
  /** What the person must know: the variables to set, and settings the other app has no place for. */
  notes: string[];
}

/** The `mcpServers` JSON (Claude Desktop, Claude Code, Cursor, Windsurf) or `servers` JSON (VS Code) for `details`. */
export function exportServers(details: readonly McpServerDetail[], format: ExportFormat): McpExport {
  const used = new Map<string, string>();
  const notes: string[] = [];
  const servers: Record<string, unknown> = {};
  for (const detail of details) {
    servers[detail.server.name] = entry(detail.config, format, used);
    const { tools, approval } = detail.config;
    const filtered = tools !== undefined && ((tools.include?.length ?? 0) > 0 || (tools.exclude?.length ?? 0) > 0);
    if (filtered || approval === "allow") {
      notes.push(`${detail.server.name}: its tool filter and approval setting have no place in that format, so they are left out`);
    }
  }
  for (const [variable, secret] of used) {
    notes.push(`set ${variable} in the other app's environment: its value is in your Keychain as ${secret}, and is never printed`);
  }
  const key = format === "vscode" ? "servers" : "mcpServers";
  return { json: JSON.stringify({ [key]: servers }, null, 2), notes };
}
