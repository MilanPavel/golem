import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";
import type { LocalServer } from "../../protocol/gen/local-server.ts";

export function formatStatus(status: DaemonStatus): string {
  const uptime = Math.round(status.uptime_seconds);
  return [
    "connected",
    `pid: ${status.pid}`,
    `version: ${status.version}`,
    `protocol: ${status.protocol_major}.${status.protocol_minor}`,
    `uptime: ${uptime}s`,
    `state: ${status.state}`,
    ...(status.local_servers ?? []).map(formatLocalServer),
  ].join("\n");
}

/** `ollama: started by golem, pid 49080, 5.2 GB`, or `ollama: running, not started by golem`. */
export function formatLocalServer(server: LocalServer): string {
  if (server.owner === "external") {
    return `${server.provider}: running, not started by golem`;
  }
  const parts = ["started by golem"];
  if (server.pid != null) {
    parts.push(`pid ${server.pid}`);
  }
  if (server.memory_mb != null) {
    parts.push(formatMemory(server.memory_mb));
  }
  return `${server.provider}: ${parts.join(", ")}`;
}

function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
