import type { ChangesRevertResult } from "../../protocol/gen/changes-revert-result.ts";
import type { KeychainWait } from "../../protocol/gen/keychain-wait.ts";
import type { McpCatalogResult } from "../../protocol/gen/mcp-catalog-result.ts";
import type { McpServerDetail } from "../../protocol/gen/mcp-server-detail.ts";
import type { ConfigRawGetResult } from "../../protocol/gen/config-raw-get-result.ts";
import type { ConfigRawResult } from "../../protocol/gen/config-raw-result.ts";
import type { McpImportApplyResult } from "../../protocol/gen/mcp-import-apply-result.ts";
import type { McpImportScanResult } from "../../protocol/gen/mcp-import-scan-result.ts";
import type { McpCallResult } from "../../protocol/gen/mcp-call-result.ts";
import type { McpLogsResult } from "../../protocol/gen/mcp-logs-result.ts";
import type { McpServerLog } from "../../protocol/gen/mcp-server-log.ts";
import type { McpTestProgress } from "../../protocol/gen/mcp-test-progress.ts";
import type { McpTestResult } from "../../protocol/gen/mcp-test-result.ts";
import type { RuntimeInstallDone } from "../../protocol/gen/runtime-install-done.ts";
import type { OllamaInstallDone } from "../../protocol/gen/ollama-install-done.ts";
import type { ChangesCommitInfoResult } from "../../protocol/gen/changes-commit-info-result.ts";
import type { ChangesCommitResult } from "../../protocol/gen/changes-commit-result.ts";
import type { ChangesListResult } from "../../protocol/gen/changes-list-result.ts";
import type { FileListResult } from "../../protocol/gen/file-list-result.ts";
import type { FileReadResult } from "../../protocol/gen/file-read-result.ts";
import type { DirEntry, FsListDirsResult } from "../../protocol/gen/fs-list-dirs-result.ts";
import type { SetupRow, SetupStatusResult } from "../../protocol/gen/setup-status-result.ts";
import type { McpListResult } from "../../protocol/gen/mcp-list-result.ts";
import type { McpLoginDone } from "../../protocol/gen/mcp-login-done.ts";
import type { McpLoginResult } from "../../protocol/gen/mcp-login-result.ts";
import type { McpServer } from "../../protocol/gen/mcp-server.ts";
import type { ModelServerStatus } from "../../protocol/gen/model-server-status.ts";
import type { ModelOptionsGetResult } from "../../protocol/gen/model-options-get-result.ts";
import type { ModelOptionsSaved } from "../../protocol/gen/model-options-saved.ts";
import type { ModelOptionsSetResult } from "../../protocol/gen/model-options-set-result.ts";
import type { PermissionsSetModeResult } from "../../protocol/gen/permissions-set-mode-result.ts";
import type { SessionCompactResult } from "../../protocol/gen/session-compact-result.ts";
import type { SessionSetChecksResult } from "../../protocol/gen/session-set-checks-result.ts";
import type { SessionSetRouteResult } from "../../protocol/gen/session-set-route-result.ts";
import type { SessionSetPlanResult } from "../../protocol/gen/session-set-plan-result.ts";
import type { SessionSetModeResult } from "../../protocol/gen/session-set-mode-result.ts";
import type { SessionSetOptionsResult } from "../../protocol/gen/session-set-options-result.ts";
import type { ListedSkill, SkillListResult } from "../../protocol/gen/skill-list-result.ts";
import type { AgentsListResult } from "../../protocol/gen/agents-list-result.ts";
import type { AgentsSetWishResult } from "../../protocol/gen/agents-set-wish-result.ts";
import type { MemoryDeleteResult } from "../../protocol/gen/memory-delete-result.ts";
import type { MemoryExportResult } from "../../protocol/gen/memory-export-result.ts";
import type { MemoryGetResult } from "../../protocol/gen/memory-get-result.ts";
import type { MemoryListResult } from "../../protocol/gen/memory-list-result.ts";
import type { MemorySettingsResult } from "../../protocol/gen/memory-settings-result.ts";
import type { MemoryUpdateResult } from "../../protocol/gen/memory-update-result.ts";
import type { MemoryWriteResult } from "../../protocol/gen/memory-write-result.ts";
import type { MemoryChanged } from "../../protocol/gen/memory-changed.ts";
import type { RoutineGetResult } from "../../protocol/gen/routine-get-result.ts";
import type { RoutineInfo, RoutineListResult } from "../../protocol/gen/routine-list-result.ts";
import type { RoutinePreviewResult } from "../../protocol/gen/routine-preview-result.ts";
import type { RoutineRemoveResult } from "../../protocol/gen/routine-remove-result.ts";
import type { RoutineRunResult } from "../../protocol/gen/routine-run-result.ts";
import type { RunListResult } from "../../protocol/gen/run-list-result.ts";
import type { SkillCreateResult } from "../../protocol/gen/skill-create-result.ts";
import type { SkillReadResult } from "../../protocol/gen/skill-read-result.ts";
import type { RoutineUpdateResult } from "../../protocol/gen/routine-update-result.ts";
import type { SkillSetDisabledResult } from "../../protocol/gen/skill-set-disabled-result.ts";
import type { SkillWriteResult } from "../../protocol/gen/skill-write-result.ts";
import type { McpRemoveResult } from "../../protocol/gen/mcp-remove-result.ts";
import type { McpToggleResult } from "../../protocol/gen/mcp-toggle-result.ts";
import type { SessionSetSkillsResult } from "../../protocol/gen/session-set-skills-result.ts";
import type { McpToolsResult } from "../../protocol/gen/mcp-tools-result.ts";
import type { AuthKeyStatus, AuthListResult } from "../../protocol/gen/auth-list-result.ts";
import type { AuthRemoveResult } from "../../protocol/gen/auth-remove-result.ts";
import type { AuthSetResult } from "../../protocol/gen/auth-set-result.ts";
import type { ConfigGetResult } from "../../protocol/gen/config-get-result.ts";
import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";
import type { HelloResult } from "../../protocol/gen/hello-result.ts";
import type { MessageSendResult } from "../../protocol/gen/message-send-result.ts";
import type { ModelListResult } from "../../protocol/gen/model-list-result.ts";
import type { ModelProbeResult } from "../../protocol/gen/model-probe-result.ts";
import type { ModelBenchDone } from "../../protocol/gen/model-bench-done.ts";
import type { ModelBenchProgress } from "../../protocol/gen/model-bench-progress.ts";
import type { ModelCheckDone } from "../../protocol/gen/model-check-done.ts";
import type { ModelCheckProgress } from "../../protocol/gen/model-check-progress.ts";
import type { ModelPullDone } from "../../protocol/gen/model-pull-done.ts";
import type { ModelPullProgress } from "../../protocol/gen/model-pull-progress.ts";
import type { ModelScoreResetResult } from "../../protocol/gen/model-score-reset-result.ts";
import type { ModelSetDefaultResult } from "../../protocol/gen/model-set-default-result.ts";
import type { SessionSetModelResult } from "../../protocol/gen/session-set-model-result.ts";
import type { Ping } from "../../protocol/gen/ping.ts";
import type { Params as ChatEvent } from "../../protocol/gen/rpc-notification.ts";
import type { RunCancelResult } from "../../protocol/gen/run-cancel-result.ts";
import type { HelperStopResult } from "../../protocol/gen/helper-stop-result.ts";
import type { SessionAttachResult } from "../../protocol/gen/session-attach-result.ts";
import type { SessionCloseResult } from "../../protocol/gen/session-close-result.ts";
import type { SessionCreateResult } from "../../protocol/gen/session-create-result.ts";
import type { SessionForkResult } from "../../protocol/gen/session-fork-result.ts";
import type { CostGetResult } from "../../protocol/gen/cost-get-result.ts";
import type { EvalRoutingResult } from "../../protocol/gen/eval-routing-result.ts";
import type { NotificationsSetResult } from "../../protocol/gen/notifications-set-result.ts";
import type { NotificationsValues } from "../../protocol/gen/notifications-values.ts";
import type { NotifyTestResult } from "../../protocol/gen/notify-test-result.ts";
import type { RoutingGetResult } from "../../protocol/gen/routing-get-result.ts";
import type { RoutingSetResult } from "../../protocol/gen/routing-set-result.ts";
import type { TraceGetResult } from "../../protocol/gen/trace-get-result.ts";
import type { TraceSpanResult } from "../../protocol/gen/trace-span-result.ts";
import type { SessionInspectResult } from "../../protocol/gen/session-inspect-result.ts";
import type { SessionListResult, SessionSummary } from "../../protocol/gen/session-list-result.ts";
import type { SessionRenameResult } from "../../protocol/gen/session-rename-result.ts";

// Every event type of the protocol. `guards.test.ts` checks it against the generated schema,
// because an event that is not here is dropped before any screen sees it.
const EVENT_TYPES = new Set([
  "session.created",
  "session.updated",
  "session.closed",
  "session.completed",
  "model.selected",
  "model.options.changed",
  "model.routed",
  "model.waiting",
  "session.mode.changed",
  "session.checks.changed",
  "session.plan.changed",
  "message.started",
  "message.delta",
  "message.thinking.delta",
  "message.completed",
  "model.call.started",
  "model.call.completed",
  "context.changed",
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "tool.requested",
  "tool.writing",
  "tool.started",
  "tool.output",
  "todos.updated",
  "plan.proposed",
  "tool.completed",
  "file.changed",
  "tool.failed",
  "approval.needed",
  "approval.resolved",
  "route.consent.needed",
  "route.consent.answered",
  "skill.activated",
  "skill.deactivated",
  "skill.skipped",
  "check.offered",
  "check.started",
  "check.completed",
  "helper.started",
  "helper.step",
  "helper.state",
  "helper.wait",
  "helper.ended",
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
    (typeof value["default"] === "string" || value["default"] === null) &&
    isModelSetup(value["setup"]) &&
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

function isModelSetup(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["ollama_installed"] === "boolean" &&
    typeof value["ollama_running"] === "boolean" &&
    Array.isArray(value["keys"])
  );
}

export function isMcpServer(value: unknown): value is McpServer {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["state"] === "string" &&
    typeof value["command"] === "string"
  );
}

export function isMcpLoginResult(value: unknown): value is McpLoginResult {
  return isRecord(value) && typeof value["name"] === "string" && typeof value["authorize_url"] === "string";
}

export function isMcpLoginDone(value: unknown): value is McpLoginDone {
  return isRecord(value) && typeof value["name"] === "string" && typeof value["ok"] === "boolean";
}

const SERVER_STATES = new Set(["starting", "ready", "failed", "stopped"]);

export function isModelServerStatus(value: unknown): value is ModelServerStatus {
  return (
    isRecord(value) &&
    typeof value["provider"] === "string" &&
    typeof value["base_url"] === "string" &&
    typeof value["state"] === "string" &&
    SERVER_STATES.has(value["state"])
  );
}

export function isMcpListResult(value: unknown): value is McpListResult {
  return isRecord(value) && Array.isArray(value["servers"]) && value["servers"].every(isMcpServer);
}

export function isRoutineInfo(value: unknown): value is RoutineInfo {
  return (
    isRecord(value) &&
    isRecord(value["config"]) &&
    typeof value["config"]["name"] === "string" &&
    typeof value["config"]["prompt"] === "string" &&
    typeof value["path"] === "string" &&
    typeof value["source"] === "string"
  );
}

function isRoutineRun(value: unknown): boolean {
  return isRecord(value) && typeof value["routine_run_id"] === "string" && typeof value["status"] === "string";
}

export function isRoutineListResult(value: unknown): value is RoutineListResult {
  return isRecord(value) && Array.isArray(value["routines"]) && value["routines"].every(isRoutineInfo);
}

const RUN_KINDS = ["routine", "ask"];
const RUN_STATUSES = ["queued", "running", "waiting", "succeeded", "failed", "skipped", "cancelled"];

function isRunInfo(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    typeof value["origin"] === "string" &&
    typeof value["kind"] === "string" &&
    RUN_KINDS.includes(value["kind"]) &&
    typeof value["status"] === "string" &&
    RUN_STATUSES.includes(value["status"]) &&
    (value["approvals"] === undefined || typeof value["approvals"] === "number")
  );
}

export function isRunListResult(value: unknown): value is RunListResult {
  return isRecord(value) && Array.isArray(value["runs"]) && value["runs"].every(isRunInfo);
}

export function isRoutineGetResult(value: unknown): value is RoutineGetResult {
  return (
    isRecord(value) &&
    isRoutineInfo(value["routine"]) &&
    (value["runs"] === undefined || (Array.isArray(value["runs"]) && value["runs"].every(isRoutineRun)))
  );
}

export function isRoutineRunResult(value: unknown): value is RoutineRunResult {
  return isRecord(value) && typeof value["routine_run_id"] === "string" && typeof value["session_id"] === "string";
}

export function isRoutinePreviewResult(value: unknown): value is RoutinePreviewResult {
  return isRecord(value) && Array.isArray(value["next"]) && value["next"].every((time) => typeof time === "string");
}

export function isRoutineRemoveResult(value: unknown): value is RoutineRemoveResult {
  return isRecord(value) && typeof value["name"] === "string";
}

export function isListedSkill(value: unknown): value is ListedSkill {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["description"] === "string" &&
    typeof value["source"] === "string" &&
    typeof value["path"] === "string" &&
    typeof value["usable"] === "boolean"
  );
}

export function isSkillListResult(value: unknown): value is SkillListResult {
  return isRecord(value) && Array.isArray(value["skills"]) && value["skills"].every(isListedSkill);
}

export function isAgentsListResult(value: unknown): value is AgentsListResult {
  return (
    isRecord(value) &&
    Array.isArray(value["agents"]) &&
    value["agents"].every(
      (agent) =>
        isRecord(agent) &&
        typeof agent["name"] === "string" &&
        typeof agent["description"] === "string" &&
        typeof agent["origin"] === "string" &&
        typeof agent["wish"] === "string",
    )
  );
}

export function isAgentsSetWishResult(value: unknown): value is AgentsSetWishResult {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["description"] === "string" &&
    typeof value["origin"] === "string" &&
    typeof value["wish"] === "string"
  );
}

export function isSkillReadResult(value: unknown): value is SkillReadResult {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    typeof value["text"] === "string" &&
    typeof value["mtime_ns"] === "number" &&
    typeof value["source"] === "string"
  );
}

export function isSkillWriteResult(value: unknown): value is SkillWriteResult {
  return isRecord(value) && typeof value["ok"] === "boolean" && typeof value["written"] === "boolean";
}

export function isSkillCreateResult(value: unknown): value is SkillCreateResult {
  return isRecord(value) && typeof value["path"] === "string" && typeof value["mtime_ns"] === "number";
}

export function isSkillSetDisabledResult(value: unknown): value is SkillSetDisabledResult {
  return isRecord(value) && typeof value["name"] === "string" && typeof value["disabled"] === "boolean";
}

const MEMORY_SCOPES = ["you", "project", "history"];

export function isMemoryItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["title"] === "string" &&
    typeof value["text"] === "string" &&
    typeof value["scope"] === "string" &&
    MEMORY_SCOPES.includes(value["scope"]) &&
    typeof value["state"] === "string" &&
    Array.isArray(value["sources"])
  );
}

function isMemorySettings(value: unknown): boolean {
  return isRecord(value) && typeof value["you"] === "string" && typeof value["projects"] === "string" && typeof value["history"] === "string";
}

export function isMemoryListResult(value: unknown): value is MemoryListResult {
  return (
    isRecord(value) &&
    Array.isArray(value["items"]) &&
    value["items"].every(isMemoryItem) &&
    typeof value["total"] === "number" &&
    isRecord(value["counts"]) &&
    isMemorySettings(value["settings"])
  );
}

export function isMemoryGetResult(value: unknown): value is MemoryGetResult {
  return isRecord(value) && isMemoryItem(value["item"]);
}

export function isMemoryWriteResult(value: unknown): value is MemoryWriteResult {
  return isRecord(value) && isMemoryItem(value["item"]);
}

export function isMemoryUpdateResult(value: unknown): value is MemoryUpdateResult {
  return isRecord(value) && isMemoryItem(value["item"]);
}

export function isMemoryDeleteResult(value: unknown): value is MemoryDeleteResult {
  return isRecord(value) && Array.isArray(value["deleted"]) && value["deleted"].every((id) => typeof id === "string");
}

export function isMemoryExportResult(value: unknown): value is MemoryExportResult {
  return isRecord(value) && typeof value["text"] === "string" && typeof value["count"] === "number";
}

export function isMemorySettingsResult(value: unknown): value is MemorySettingsResult {
  return isRecord(value) && isMemorySettings(value["settings"]);
}

export function isMemoryChanged(value: unknown): value is MemoryChanged {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["change"] === "string" &&
    ["created", "updated", "deleted", "stale", "resolved"].includes(value["change"]) &&
    typeof value["scope"] === "string" &&
    MEMORY_SCOPES.includes(value["scope"])
  );
}

export function isSessionSetSkillsResult(value: unknown): value is SessionSetSkillsResult {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    Array.isArray(value["skills"]) &&
    value["skills"].every((name) => typeof name === "string")
  );
}

export function isMcpToggleResult(value: unknown): value is McpToggleResult {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    Array.isArray(value["mcp_servers"]) &&
    value["mcp_servers"].every((name) => typeof name === "string")
  );
}

export function isMcpToolsResult(value: unknown): value is McpToolsResult {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    Array.isArray(value["tools"]) &&
    value["tools"].every(
      (tool) => isRecord(tool) && typeof tool["name"] === "string" && typeof tool["description"] === "string",
    )
  );
}

export function isModelProbeResult(value: unknown): value is ModelProbeResult {
  return isRecord(value) && typeof value["ref"] === "string" && typeof value["installed"] === "boolean";
}

/** A `{ref, <flag>: boolean}` result, as model.pull, model.pull_cancel, and model.delete return. */
export function isRefResult(value: unknown, flag: string): boolean {
  return isRecord(value) && typeof value["ref"] === "string" && typeof value[flag] === "boolean";
}

export function isPullProgress(value: unknown): value is ModelPullProgress {
  return isRecord(value) && typeof value["ref"] === "string" && typeof value["status"] === "string";
}

export function isPullDone(value: unknown): value is ModelPullDone {
  return isRecord(value) && typeof value["ref"] === "string" && typeof value["ok"] === "boolean";
}

export function isCheckProgress(value: unknown): value is ModelCheckProgress {
  return (
    isRecord(value) &&
    typeof value["ref"] === "string" &&
    typeof value["index"] === "number" &&
    typeof value["total"] === "number" &&
    isRecord(value["result"])
  );
}

export function isBenchProgress(value: unknown): value is ModelBenchProgress {
  return (
    isRecord(value) &&
    typeof value["ref"] === "string" &&
    typeof value["index"] === "number" &&
    typeof value["total"] === "number" &&
    isRecord(value["row"]) &&
    Array.isArray(value["row"]["each"])
  );
}

export function isBenchDone(value: unknown): value is ModelBenchDone {
  return (
    isRecord(value) &&
    typeof value["ref"] === "string" &&
    typeof value["ok"] === "boolean" &&
    (value["rows"] === undefined || Array.isArray(value["rows"]))
  );
}

export function isCheckDone(value: unknown): value is ModelCheckDone {
  return isRecord(value) && typeof value["ref"] === "string" && typeof value["ok"] === "boolean";
}

export function isSessionSetModelResult(value: unknown): value is SessionSetModelResult {
  return isRecord(value) && typeof value["session_id"] === "string" && typeof value["model_profile"] === "string";
}

function isOptionValues(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "number" || typeof item === "string");
}

function isModelMemory(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["ram_gb", "size_gb", "kv_gb_per_1k_tokens", "overhead_gb", "fits_share", "tight_share"].every(
      (key) => typeof value[key] === "number",
    )
  );
}

export function isModelOptionsGetResult(value: unknown): value is ModelOptionsGetResult {
  return (
    isRecord(value) &&
    typeof value["model"] === "string" &&
    Array.isArray(value["options"]) &&
    value["options"].every(
      (row) =>
        isRecord(row) &&
        typeof row["name"] === "string" &&
        typeof row["kind"] === "string" &&
        typeof row["minimum"] === "number" &&
        typeof row["maximum"] === "number" &&
        typeof row["step"] === "number",
    ) &&
    isOptionValues(value["defaults"]) &&
    isOptionValues(value["saved"]) &&
    (value["session"] === undefined || value["session"] === null || isOptionValues(value["session"])) &&
    (value["memory"] === undefined || value["memory"] === null || isModelMemory(value["memory"]))
  );
}

export function isModelOptionsSaved(value: unknown): value is ModelOptionsSaved {
  return isRecord(value) && typeof value["model"] === "string" && isOptionValues(value["saved"]);
}

export function isModelOptionsSetResult(value: unknown): value is ModelOptionsSetResult {
  return isModelOptionsSaved(value);
}

export function isSessionSetOptionsResult(value: unknown): value is SessionSetOptionsResult {
  return isRecord(value) && typeof value["session_id"] === "string" && isOptionValues(value["options"]);
}

export function isSessionCompactResult(value: unknown): value is SessionCompactResult {
  return (
    isRecord(value) &&
    typeof value["before_tokens"] === "number" &&
    typeof value["after_tokens"] === "number" &&
    typeof value["count"] === "number" &&
    (value["window"] === undefined || value["window"] === null || typeof value["window"] === "number") &&
    (value["model"] === undefined || value["model"] === null || typeof value["model"] === "string") &&
    (value["window_from"] === undefined || value["window_from"] === null || typeof value["window_from"] === "number") &&
    (value["window_to"] === undefined || value["window_to"] === null || typeof value["window_to"] === "number")
  );
}

export function isSessionSetChecksResult(value: unknown): value is SessionSetChecksResult {
  return isRecord(value) && typeof value["session_id"] === "string" && typeof value["on"] === "boolean";
}

export function isSessionSetRouteResult(value: unknown): value is SessionSetRouteResult {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    (value["mode"] === "pinned" || value["mode"] === "local" || value["mode"] === "auto")
  );
}

export function isSessionSetPlanResult(value: unknown): value is SessionSetPlanResult {
  return isRecord(value) && typeof value["session_id"] === "string" && typeof value["on"] === "boolean";
}

export function isSessionSetModeResult(value: unknown): value is SessionSetModeResult {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    (value["mode"] === "careful" || value["mode"] === "balanced" || value["mode"] === "autopilot") &&
    typeof value["override"] === "boolean"
  );
}

export function isPermissionsSetModeResult(value: unknown): value is PermissionsSetModeResult {
  return (
    isRecord(value) &&
    (value["mode"] === "careful" || value["mode"] === "balanced" || value["mode"] === "autopilot") &&
    typeof value["path"] === "string"
  );
}

export function isModelSetDefaultResult(value: unknown): value is ModelSetDefaultResult {
  return isRecord(value) && typeof value["default"] === "string";
}

export function isModelScoreResetResult(value: unknown): value is ModelScoreResetResult {
  return isRecord(value) && typeof value["ref"] === "string";
}

export function isAuthSetResult(value: unknown): value is AuthSetResult {
  const models = isRecord(value) ? value["models"] : undefined;
  return (
    isRecord(value) &&
    typeof value["provider"] === "string" &&
    (models === undefined || models === null || typeof models === "number")
  );
}

const SETUP_PARTS = new Set(["service", "socket", "config", "engine", "model", "tools", "disk"]);
const SETUP_STATES = new Set(["ok", "warn", "fail"]);

function isSetupRow(value: unknown): value is SetupRow {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["detail"] === "string" &&
    typeof value["part"] === "string" &&
    SETUP_PARTS.has(value["part"]) &&
    typeof value["state"] === "string" &&
    SETUP_STATES.has(value["state"]) &&
    (value["action"] === undefined || value["action"] === null || typeof value["action"] === "string")
  );
}

export function isSetupStatusResult(value: unknown): value is SetupStatusResult {
  return isRecord(value) && Array.isArray(value["rows"]) && value["rows"].every(isSetupRow);
}

function isDirEntry(value: unknown): value is DirEntry {
  return isRecord(value) && typeof value["name"] === "string" && typeof value["path"] === "string" && typeof value["git"] === "boolean";
}

export function isFsListDirsResult(value: unknown): value is FsListDirsResult {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    typeof value["home"] === "string" &&
    (value["parent"] === undefined || value["parent"] === null || typeof value["parent"] === "string") &&
    Array.isArray(value["entries"]) &&
    value["entries"].every(isDirEntry) &&
    typeof value["truncated"] === "boolean"
  );
}

function isChangedFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    (value["status"] === "created" || value["status"] === "modified" || value["status"] === "deleted") &&
    typeof value["added"] === "number" &&
    typeof value["removed"] === "number" &&
    Array.isArray(value["change_ids"]) &&
    value["change_ids"].every((id) => typeof id === "string") &&
    typeof value["stale"] === "boolean"
  );
}

export function isChangesListResult(value: unknown): value is ChangesListResult {
  return isRecord(value) && Array.isArray(value["files"]) && value["files"].every(isChangedFile);
}

export function isChangesRevertResult(value: unknown): value is ChangesRevertResult {
  return (
    isRecord(value) &&
    Array.isArray(value["reverted"]) &&
    value["reverted"].every((path) => typeof path === "string") &&
    Array.isArray(value["conflicts"]) &&
    value["conflicts"].every(
      (conflict) =>
        isRecord(conflict) && typeof conflict["path"] === "string" && conflict["reason"] === "changed_on_disk",
    )
  );
}

export function isFileReadResult(value: unknown): value is FileReadResult {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    typeof value["text"] === "string" &&
    typeof value["truncated"] === "boolean" &&
    typeof value["lines"] === "number"
  );
}

export function isFileListResult(value: unknown): value is FileListResult {
  return (
    isRecord(value) &&
    Array.isArray(value["paths"]) &&
    value["paths"].every((path) => typeof path === "string") &&
    typeof value["more"] === "boolean"
  );
}

export function isChangesCommitResult(value: unknown): value is ChangesCommitResult {
  return (
    isRecord(value) &&
    typeof value["ok"] === "boolean" &&
    (value["sha"] === null || typeof value["sha"] === "string") &&
    typeof value["output"] === "string"
  );
}

export function isChangesCommitInfoResult(value: unknown): value is ChangesCommitInfoResult {
  return (
    isRecord(value) &&
    typeof value["repository"] === "boolean" &&
    (value["branch"] === null || typeof value["branch"] === "string") &&
    Array.isArray(value["paths"]) &&
    value["paths"].every((path) => typeof path === "string")
  );
}

export function isKeychainWait(value: unknown): value is KeychainWait {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    (value["provider"] === undefined || value["provider"] === null || typeof value["provider"] === "string") &&
    typeof value["waiting"] === "boolean"
  );
}

export function isOllamaInstallDone(value: unknown): value is OllamaInstallDone {
  return (
    isRecord(value) &&
    (value["outcome"] === "installed" || value["outcome"] === "failed" || value["outcome"] === "stopped")
  );
}

export function isMcpRemoveResult(value: unknown): value is McpRemoveResult {
  return isRecord(value) && typeof value["name"] === "string" && typeof value["secret"] === "boolean";
}

export function isAuthRemoveResult(value: unknown): value is AuthRemoveResult {
  return isRecord(value) && typeof value["provider"] === "string" && typeof value["removed"] === "boolean";
}

export function isConfigGetResult(value: unknown): value is ConfigGetResult {
  return (
    isRecord(value) &&
    typeof value["config_file"] === "string" &&
    (typeof value["default_model"] === "string" || value["default_model"] === null) &&
    Array.isArray(value["rules"]) &&
    value["rules"].every(
      (rule) =>
        isRecord(rule) &&
        typeof rule["tool"] === "string" &&
        typeof rule["action"] === "string" &&
        typeof rule["source"] === "string",
    )
  );
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
    (value["status"] === "idle" ||
      value["status"] === "running" ||
      value["status"] === "waiting" ||
      value["status"] === "closed") &&
    typeof value["created_at"] === "string" &&
    typeof value["updated_at"] === "string" &&
    typeof value["last_seq"] === "number" &&
    (value["title"] === undefined || value["title"] === null || typeof value["title"] === "string") &&
    (value["cwd"] === undefined || value["cwd"] === null || typeof value["cwd"] === "string")
  );
}

export function isSessionRenameResult(value: unknown): value is SessionRenameResult {
  return isRecord(value) && typeof value["title"] === "string";
}

export function isRunCancelResult(value: unknown): value is RunCancelResult {
  return isRecord(value) && typeof value["cancelled"] === "boolean";
}

export function isHelperStopResult(value: unknown): value is HelperStopResult {
  return isRecord(value) && typeof value["stopped"] === "boolean";
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

const SPAN_KINDS = new Set(["run", "model", "tool"]);
const SPAN_STATUSES = new Set(["ok", "failed", "cancelled", "denied", "running"]);

function isTraceSpan(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["kind"] === "string" &&
    SPAN_KINDS.has(value["kind"]) &&
    typeof value["name"] === "string" &&
    typeof value["start"] === "string" &&
    typeof value["status"] === "string" &&
    SPAN_STATUSES.has(value["status"]) &&
    (value["children"] === undefined ||
      (Array.isArray(value["children"]) && value["children"].every(isTraceSpan)))
  );
}

function isCostTotals(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["calls", "input", "output", "cost_usd", "saved_usd"].every((key) => typeof value[key] === "number")
  );
}

export function isCostGetResult(value: unknown): value is CostGetResult {
  return (
    isRecord(value) &&
    isCostTotals(value["today"]) &&
    isCostTotals(value["week"]) &&
    (value["session"] == null || isCostTotals(value["session"])) &&
    (value["by_model"] === undefined || Array.isArray(value["by_model"])) &&
    (value["by_day"] === undefined || Array.isArray(value["by_day"]))
  );
}

function isEvalRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    ["calls", "input", "output", "cost_usd", "cuts", "clears", "summaries"].every(
      (key) => typeof value[key] === "number",
    )
  );
}

export function isEvalRoutingResult(value: unknown): value is EvalRoutingResult {
  return (
    isRecord(value) &&
    ["days", "sessions", "calls", "skipped"].every((key) => typeof value[key] === "number") &&
    isEvalRow(value["actual"]) &&
    (value["scenarios"] === undefined ||
      (Array.isArray(value["scenarios"]) && value["scenarios"].every(isEvalRow))) &&
    (value["top"] === undefined || Array.isArray(value["top"]))
  );
}

export function isNotificationsValues(value: unknown): value is NotificationsValues {
  return (
    isRecord(value) &&
    typeof value["needs_you"] === "boolean" &&
    typeof value["failed"] === "boolean" &&
    typeof value["finished"] === "boolean" &&
    (value["open_in"] === "web" || value["open_in"] === "terminal") &&
    typeof value["terminal_app"] === "string" &&
    Array.isArray(value["terminal_apps"])
  );
}

export function isNotificationsSetResult(value: unknown): value is NotificationsSetResult {
  return (
    isRecord(value) &&
    typeof value["ok"] === "boolean" &&
    (value["errors"] === undefined || Array.isArray(value["errors"])) &&
    (value["values"] == null || isNotificationsValues(value["values"]))
  );
}

export function isNotifyTestResult(value: unknown): value is NotifyTestResult {
  return isRecord(value) && typeof value["posted"] === "boolean" && typeof value["mechanism"] === "string";
}

export function isRoutingGetResult(value: unknown): value is RoutingGetResult {
  return (
    isRecord(value) &&
    ["routing", "ladder", "roles", "budget", "context", "picked"].every((key) => isRecord(value[key])) &&
    Array.isArray((value["routing"] as Record<string, unknown>)["local_only"])
  );
}

export function isRoutingSetResult(value: unknown): value is RoutingSetResult {
  return (
    isRecord(value) &&
    typeof value["ok"] === "boolean" &&
    (value["errors"] === undefined || Array.isArray(value["errors"])) &&
    (value["values"] == null || isRoutingGetResult(value["values"]))
  );
}

export function isTraceGetResult(value: unknown): value is TraceGetResult {
  return (
    isRecord(value) &&
    typeof value["session_id"] === "string" &&
    Array.isArray(value["runs"]) &&
    value["runs"].every(isTraceSpan)
  );
}

export function isTraceSpanResult(value: unknown): value is TraceSpanResult {
  return (
    isRecord(value) &&
    isTraceSpan(value["span"]) &&
    Array.isArray(value["messages"]) &&
    isOptionalString(value["system_prompt"]) &&
    isOptionalString(value["result"]) &&
    isOptionalString(value["artifact_id"])
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

export function isRuntimeName(value: unknown): value is "node" | "uv" {
  return value === "node" || value === "uv";
}

export function isRuntimeInstallDone(value: unknown): value is RuntimeInstallDone {
  return isRecord(value) && isRuntimeName(value["name"]) && typeof value["ok"] === "boolean";
}

const TEST_STEPS = new Set(["resolve", "spawn", "connect", "initialize", "tools", "ping"]);
const STEP_STATES = new Set(["running", "ok", "failed", "skipped"]);

function isTestStep(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["step"] === "string" &&
    TEST_STEPS.has(value["step"]) &&
    typeof value["state"] === "string" &&
    STEP_STATES.has(value["state"])
  );
}

export function isMcpTestProgress(value: unknown): value is McpTestProgress {
  return isRecord(value) && typeof value["test_id"] === "string" && isTestStep(value);
}

export function isMcpTestResult(value: unknown): value is McpTestResult {
  return (
    isRecord(value) &&
    typeof value["test_id"] === "string" &&
    typeof value["ok"] === "boolean" &&
    Array.isArray(value["steps"]) &&
    value["steps"].every(isTestStep)
  );
}

function isLogLine(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["ts"] === "number" &&
    (value["kind"] === "stderr" || value["kind"] === "event") &&
    typeof value["text"] === "string"
  );
}

export function isMcpCallResult(value: unknown): value is McpCallResult {
  return isRecord(value) && typeof value["text"] === "string" && typeof value["is_error"] === "boolean";
}

export function isMcpLogsResult(value: unknown): value is McpLogsResult {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    Array.isArray(value["lines"]) &&
    value["lines"].every(isLogLine)
  );
}

export function isMcpServerLog(value: unknown): value is McpServerLog {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    Array.isArray(value["lines"]) &&
    value["lines"].every(isLogLine)
  );
}

export function isConfigRawGetResult(value: unknown): value is ConfigRawGetResult {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    typeof value["text"] === "string" &&
    typeof value["exists"] === "boolean" &&
    (value["mtime_ns"] === null || value["mtime_ns"] === undefined || typeof value["mtime_ns"] === "number")
  );
}

export function isConfigRawResult(value: unknown): value is ConfigRawResult {
  return (
    isRecord(value) &&
    typeof value["ok"] === "boolean" &&
    (value["errors"] === undefined || Array.isArray(value["errors"])) &&
    (value["restart_needed"] === undefined || Array.isArray(value["restart_needed"]))
  );
}

function isImportCandidate(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["key"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["original_name"] === "string" &&
    isRecord(value["config"])
  );
}

export function isMcpImportScanResult(value: unknown): value is McpImportScanResult {
  return (
    isRecord(value) &&
    typeof value["scan_id"] === "string" &&
    Array.isArray(value["sources"]) &&
    value["sources"].every(
      (source) =>
        isRecord(source) &&
        typeof source["id"] === "string" &&
        typeof source["label"] === "string" &&
        Array.isArray(source["candidates"]) &&
        source["candidates"].every(isImportCandidate),
    )
  );
}

export function isMcpImportApplyResult(value: unknown): value is McpImportApplyResult {
  return (
    isRecord(value) &&
    Array.isArray(value["added"]) &&
    value["added"].every(isMcpServer) &&
    (value["failed"] === undefined ||
      (Array.isArray(value["failed"]) &&
        value["failed"].every((each) => isRecord(each) && typeof each["key"] === "string" && typeof each["error"] === "string")))
  );
}

export function isMcpServerDetail(value: unknown): value is McpServerDetail {
  return (
    isRecord(value) &&
    isMcpServer(value["server"]) &&
    isRecord(value["config"]) &&
    typeof value["path"] === "string" &&
    (value["scope"] === "user" || value["scope"] === "project") &&
    Array.isArray(value["secrets"])
  );
}

export function isMcpCatalogResult(value: unknown): value is McpCatalogResult {
  return (
    isRecord(value) &&
    Array.isArray(value["entries"]) &&
    value["entries"].every(
      (entry) =>
        isRecord(entry) &&
        typeof entry["id"] === "string" &&
        typeof entry["name"] === "string" &&
        typeof entry["title"] === "string" &&
        typeof entry["description"] === "string",
    )
  );
}

export function isRoutineUpdateResult(value: unknown): value is RoutineUpdateResult {
  return isRecord(value) && isRoutineInfo(value["routine"]);
}
