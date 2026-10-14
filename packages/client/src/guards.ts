import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";
import type { HelloResult } from "../../protocol/gen/hello-result.ts";
import type { MessageSendResult } from "../../protocol/gen/message-send-result.ts";
import type { Ping } from "../../protocol/gen/ping.ts";
import type { Params as ChatEvent } from "../../protocol/gen/rpc-notification.ts";
import type { SessionCreateResult } from "../../protocol/gen/session-create-result.ts";
import type { SessionInspectResult } from "../../protocol/gen/session-inspect-result.ts";

const EVENT_TYPES = new Set([
  "session.created",
  "message.started",
  "message.delta",
  "message.completed",
  "run.started",
  "run.completed",
  "run.failed",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isHelloResult(value: unknown): value is HelloResult {
  return isRecord(value) && typeof value["protocol_major"] === "number";
}

export function isPing(value: unknown): value is Ping {
  return isRecord(value) && value["type"] === "system.ping" && typeof value["nonce"] === "string";
}

export function asChatEvent(value: unknown): ChatEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const type = value["type"];
  if (typeof type !== "string" || !EVENT_TYPES.has(type)) {
    return undefined;
  }
  if (typeof value["seq"] !== "number" || typeof value["session_id"] !== "string") {
    return undefined;
  }
  if (!isRecord(value["data"])) {
    return undefined;
  }
  return value as unknown as ChatEvent;
}

export function isSessionCreateResult(value: unknown): value is SessionCreateResult {
  return isRecord(value) && typeof value["session_id"] === "string";
}

export function isMessageSendResult(value: unknown): value is MessageSendResult {
  return isRecord(value) && typeof value["run_id"] === "string";
}

export function isSessionInspectResult(value: unknown): value is SessionInspectResult {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    typeof value["model_profile"] === "string" &&
    typeof value["message_count"] === "number" &&
    Array.isArray(value["messages"]) &&
    isOptionalString(value["model_provider"]) &&
    isOptionalString(value["model_name"])
  );
}

export function isDaemonStatus(value: unknown): value is DaemonStatus {
  return (
    isRecord(value) &&
    typeof value["pid"] === "number" &&
    typeof value["version"] === "string" &&
    typeof value["protocol_major"] === "number" &&
    typeof value["protocol_minor"] === "number" &&
    typeof value["uptime_seconds"] === "number" &&
    (value["state"] === "running" || value["state"] === "draining") &&
    isOptionalString(value["model_profile"]) &&
    isOptionalString(value["model_provider"]) &&
    isOptionalString(value["model_name"])
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.length > 0);
}
