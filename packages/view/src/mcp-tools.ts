import type { McpLogsResult, McpServerConfig, McpTestProgress, McpTestResult } from "@golem/client";

/**
 * What a test, a log, and a tool filter look like to a person. Pure, so the CLI and the TUI
 * say the same thing.
 */
type LogLine = McpLogsResult["lines"][number];

/** A step of a test, once it has ended. A step that is only starting has no line. */
export function formatTestStep(progress: McpTestProgress): string | null {
  if (progress.state === "running") return null;
  const mark = progress.state === "ok" ? "✓" : progress.state === "failed" ? "✗" : "-";
  const took = progress.state === "skipped" ? "" : ` ${progress.elapsed_ms ?? 0} ms`;
  return `${mark} ${progress.step}${took}${progress.detail ? `  ${progress.detail}` : ""}`;
}

/** The end of a test: what it found, the server's stderr when it failed, and one next step. */
export function formatTestResult(result: McpTestResult): string {
  const lines: string[] = [];
  if (result.ok) {
    const info = result.server_info;
    const who = info === undefined || info === null ? "" : `${[info.name, info.version].filter(Boolean).join(" ")}, `;
    lines.push(`ok: ${who}${result.tools?.length ?? 0} tools`);
  } else {
    lines.push("failed");
    if ((result.stderr_tail ?? []).length > 0) {
      lines.push("the server said:", ...(result.stderr_tail ?? []).slice(-10).map((line) => `  ${line}`));
    }
  }
  if (result.hint) lines.push(result.hint);
  return lines.join("\n");
}

/** `HH:MM:SS stderr text`, or `event` for what golem did to the server. */
export function formatLogLine(line: LogLine): string {
  const time = new Date(line.ts * 1000).toTimeString().slice(0, 8);
  return `${time} ${line.kind === "event" ? "event " : "stderr"} ${line.text}`;
}

/** The server's own tool name: `mcp__git__status` is `status` for server `git`. */
export function ownToolName(server: string, name: string): string {
  const prefix = `mcp__${server}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}


export type ToolsChange = { ok: true; config: McpServerConfig } | { ok: false; message: string };

/** `config` with `hide` patterns added to `tools.exclude` and `show` patterns taken out. */
export function changeToolFilter(config: McpServerConfig, hide: readonly string[], show: readonly string[]): ToolsChange {
  const exclude = [...(config.tools?.exclude ?? [])];
  for (const pattern of show) {
    const at = exclude.indexOf(pattern);
    if (at === -1) {
      const known = exclude.length > 0 ? `hidden patterns: ${exclude.join(", ")}` : "nothing is hidden";
      return { ok: false, message: `${pattern} is not a hidden pattern (${known})` };
    }
    exclude.splice(at, 1);
  }
  for (const pattern of hide) {
    if (!exclude.includes(pattern)) exclude.push(pattern);
  }
  return { ok: true, config: { ...config, tools: { include: config.tools?.include ?? [], exclude } } };
}
