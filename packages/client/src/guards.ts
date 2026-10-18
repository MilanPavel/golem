import type { AuthKeyStatus, AuthListResult } from "../../protocol/gen/auth-list-result.ts";
import type { AuthRemoveResult } from "../../protocol/gen/auth-remove-result.ts";
import type { AuthSetResult } from "../../protocol/gen/auth-set-result.ts";
import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";
import type { HelloResult } from "../../protocol/gen/hello-result.ts";
import type { MessageSendResult } from "../../protocol/gen/message-send-result.ts";
import type { ModelListResult } from "../../protocol/gen/model-list-result.ts";
import type { ModelSetDefaultResult } from "../../protocol/gen/model-set-default-result.ts";
import type { SessionSetModelResult } from "../../protocol/gen/session-set-model-result.ts";
import type { Ping } from "../../protocol/gen/ping.ts";
import type { Params as ChatEvent } from "../../protocol/gen/rpc-notification.ts";
import type { RunCancelResult } from "../../protocol/gen/run-cancel-result.ts";
import type { SessionAttachResult } from "../../protocol/gen/session-attach-result.ts";
import type { SessionCloseResult } from "../../protocol/gen/session-close-result.ts";
import type { SessionCreateResult } from "../../protocol/gen/session-create-result.ts";
import type { SessionForkResult } from "../../protocol/gen/session-fork-result.ts";
import type { SessionInspectResult } from "../../protocol/gen/session-inspect-result.ts";
import type { SessionListResult, SessionSummary } from "../../protocol/gen/session-list-result.ts";
import type { SessionRenameResult } from "../../protocol/gen/session-rename-result.ts";

const EVENT_TYPES = new Set([
  "session.created",
  "session.updated",
  "session.closed",
  "model.selected",
  "message.started",
  "message.delta",
  "message.completed",
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
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

export function isModelListResult(value: unknown): value is ModelListResult {
  return (
    isRecord(value) &&
    typeof value["default"] === "string" &&
    Array.isArray(value["providers"]) &&
    Array.isArray(value["models"]) &&
    value["models"].every(
      (model) =>
        isRecord(model) &&
        typeof model["ref"] === "string" &&
        typeof model["label"] === "string" &&
        typeof model["provider"] === "string" &&
        typeof model["status"] === "string",
    )
  );
}

export function isSessionSetModelResult(value: unknown): value is SessionSetModelResult {
  return isRecord(value) && typeof value["session_id"] === "string" && typeof value["model_profile"] === "string";
}

export function isModelSetDefaultResult(value: unknown): value is ModelSetDefaultResult {
  return isRecord(value) && typeof value["default"] === "string";
}

export function isAuthSetResult(value: unknown): value is AuthSetResult {
  return isRecord(value) && typeof value["provider"] === "string";
}

export function isAuthRemoveResult(value: unknown): value is AuthRemoveResult {
  return isRecord(value) && typeof value["provider"] === "string" && typeof value["removed"] === "boolean";
}

export function isAuthListResult(value: unknown): value is AuthListResult {
  return isRecord(value) && Array.isArray(value["providers"]) && value["providers"].every(isAuthKeyStatus);
}

function isAuthKeyStatus(value: unknown): value is AuthKeyStatus {
  return (
    isRecord(value) &&
    typeof value["provider"] === "string" &&
    typeof value["takes_key"] === "boolean" &&
    typeof value["needs_key"] === "boolean"
  );
}

export function isSessionCreateResult(value: unknown): value is SessionCreateResult {
  return isRecord(value) && typeof value["session_id"] === "string";
}

export function isSessionCloseResult(value: unknown): value is SessionCloseResult {
  return isRecord(value) && typeof value["session_id"] === "string";
}

export function isSessionForkResult(value: unknown): value is SessionForkResult {
  return isRecord(value) && typeof value["session_id"] === "string";
}

export function isSessionAttachResult(value: unknown): value is SessionAttachResult {
  return (
    isRecord(value) && typeof value["session_id"] === "string" && typeof value["last_seq"] === "number"
  );
}

export function isSessionListResult(value: unknown): value is SessionListResult {
  return isRecord(value) && Array.isArray(value["sessions"]) && value["sessions"].every(isSessionSummary);
}

export function isSessionSummary(value: unknown): value is SessionSummary {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    typeof value["model_profile"] === "string" &&
    (value["status"] === "idle" || value["status"] === "running" || value["status"] === "closed") &&
    typeof value["created_at"] === "string" &&
    typeof value["updated_at"] === "string" &&
    typeof value["last_seq"] === "number" &&
    (value["title"] === undefined || value["title"] === null || typeof value["title"] === "string")
  );
}

export function isSessionRenameResult(value: unknown): value is SessionRenameResult {
  return isRecord(value) && typeof value["title"] === "string";
}

export function isRunCancelResult(value: unknown): value is RunCancelResult {
  return isRecord(value) && typeof value["cancelled"] === "boolean";
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
