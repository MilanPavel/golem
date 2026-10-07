import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";

export function formatStatus(status: DaemonStatus): string {
  const uptime = Math.round(status.uptime_seconds);
  return [
    "connected",
    `pid: ${status.pid}`,
    `version: ${status.version}`,
    `protocol: ${status.protocol_major}.${status.protocol_minor}`,
    `uptime: ${uptime}s`,
    `state: ${status.state}`,
  ].join("\n");
}
