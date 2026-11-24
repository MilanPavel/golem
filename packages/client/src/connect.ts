import type { Dial, Link } from "./link.ts";

import type { AuthListResult } from "../../protocol/gen/auth-list-result.ts";
import type { AuthRemoveResult } from "../../protocol/gen/auth-remove-result.ts";
import type { AuthSetResult } from "../../protocol/gen/auth-set-result.ts";
import type { McpAddParams } from "../../protocol/gen/mcp-add-params.ts";
import type { McpCatalogParams } from "../../protocol/gen/mcp-catalog-params.ts";
import type { McpCatalogResult } from "../../protocol/gen/mcp-catalog-result.ts";
import type { McpServerConfig, McpServerDetail } from "../../protocol/gen/mcp-server-detail.ts";
import type { RuntimeInstallCancelResult } from "../../protocol/gen/runtime-install-cancel-result.ts";
import type { RuntimeInstallDone } from "../../protocol/gen/runtime-install-done.ts";
import type { RuntimeInstallResult } from "../../protocol/gen/runtime-install-result.ts";
import type { RuntimeName } from "./runtime.ts";
import type { McpLoginDone } from "../../protocol/gen/mcp-login-done.ts";
import type { McpLoginResult } from "../../protocol/gen/mcp-login-result.ts";
import type { McpRemoveResult } from "../../protocol/gen/mcp-remove-result.ts";
import type { OllamaInstallCancelResult } from "../../protocol/gen/ollama-install-cancel-result.ts";
import type { KeychainWait } from "../../protocol/gen/keychain-wait.ts";
import type { OllamaInstallDone } from "../../protocol/gen/ollama-install-done.ts";
import type { OllamaInstallResult } from "../../protocol/gen/ollama-install-result.ts";
import type { OllamaStartResult } from "../../protocol/gen/ollama-start-result.ts";
import type { FsListDirsResult } from "../../protocol/gen/fs-list-dirs-result.ts";
import type { FsChooseFolderResult } from "../../protocol/gen/fs-choose-folder-result.ts";
import type { GitBranchesResult } from "../../protocol/gen/git-branches-result.ts";
import type { FsRevealResult } from "../../protocol/gen/fs-reveal-result.ts";
import type { GitInfoResult } from "../../protocol/gen/git-info-result.ts";
import type { SetupStatusResult } from "../../protocol/gen/setup-status-result.ts";
import type { ApprovalRespondResult } from "../../protocol/gen/approval-respond-result.ts";
import type { RouteConsentAnswerResult } from "../../protocol/gen/route-consent-answer-result.ts";
import type { ArtifactReadResult } from "../../protocol/gen/artifact-read-result.ts";
import type { ChangesCommitInfoResult } from "../../protocol/gen/changes-commit-info-result.ts";
import type { ChangesCommitResult } from "../../protocol/gen/changes-commit-result.ts";
import type { ChangesDiffResult } from "../../protocol/gen/changes-diff-result.ts";
import type { ChangesListResult } from "../../protocol/gen/changes-list-result.ts";
import type { ChangesRevertResult } from "../../protocol/gen/changes-revert-result.ts";
import type { FileListResult } from "../../protocol/gen/file-list-result.ts";
import type { FileReadResult } from "../../protocol/gen/file-read-result.ts";
import type { ChangesSuggestMessageResult } from "../../protocol/gen/changes-suggest-message-result.ts";
import type { ConfigGetResult } from "../../protocol/gen/config-get-result.ts";
import type { PolicyEditResult } from "../../protocol/gen/policy-edit-result.ts";

/** What `changes.diff` shows: the net change of one file, or one change. */
export type ChangesDiffTarget = { path: string } | { changeId: string };

/** What `changes.revert` takes back: one change, a file, one hunk of a file, or a turn and all after it. */
export type ChangesRevertTarget =
  | { kind: "change"; changeId: string }
  | { kind: "file"; path: string }
  | { kind: "hunk"; path: string; hunk: number }
  | { kind: "run"; runId: string };

export type ApprovalChoice = "allow" | "allow_session" | "allow_always" | "deny";

/** An answer to the paid step-up question: this session, this turn only, or stay local. */
export type ConsentChoice = "session" | "once" | "local";

/** `cwd` is the sender's folder. `skill` runs a skill once by name. `stronger` runs the turn one tier up. */
export type SendOptions = { cwd?: string; skill?: SkillCall; stronger?: boolean };
import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";
import type { McpListResult } from "../../protocol/gen/mcp-list-result.ts";
import type { McpServer } from "../../protocol/gen/mcp-server.ts";
import type { ModelServerStatus } from "../../protocol/gen/model-server-status.ts";
import type { DeviceListResult } from "../../protocol/gen/device-list-result.ts";
import type { DevicePairBeginResult } from "../../protocol/gen/device-pair-begin-result.ts";
import type { DevicePairChanged } from "../../protocol/gen/device-pair-changed.ts";
import type { DevicePairConfirmResult } from "../../protocol/gen/device-pair-confirm-result.ts";
import type { DeviceRenameResult } from "../../protocol/gen/device-rename-result.ts";
import type { DeviceRevokeResult } from "../../protocol/gen/device-revoke-result.ts";
import type { MemoryChanged } from "../../protocol/gen/memory-changed.ts";
import type { MemoryDeleteResult } from "../../protocol/gen/memory-delete-result.ts";
import type { MemoryExportParams } from "../../protocol/gen/memory-export-params.ts";
import type { MemoryExportResult } from "../../protocol/gen/memory-export-result.ts";
import type { MemoryGetResult } from "../../protocol/gen/memory-get-result.ts";
import type { MemoryListParams } from "../../protocol/gen/memory-list-params.ts";
import type { MemoryListResult } from "../../protocol/gen/memory-list-result.ts";
import type { MemorySettingsResult } from "../../protocol/gen/memory-settings-result.ts";
import type { MemoryUpdateParams } from "../../protocol/gen/memory-update-params.ts";
import type { MemoryUpdateResult } from "../../protocol/gen/memory-update-result.ts";
import type { MemoryWriteParams } from "../../protocol/gen/memory-write-params.ts";
import type { MemoryWriteResult } from "../../protocol/gen/memory-write-result.ts";
import type { RoutineGetResult } from "../../protocol/gen/routine-get-result.ts";
import type { RoutineListResult } from "../../protocol/gen/routine-list-result.ts";
import type { RoutinePreviewResult } from "../../protocol/gen/routine-preview-result.ts";
import type { RoutineRemoveResult } from "../../protocol/gen/routine-remove-result.ts";
import type { RoutineRunResult } from "../../protocol/gen/routine-run-result.ts";
import type { RunListResult } from "../../protocol/gen/run-list-result.ts";
import type { SkillCall } from "../../protocol/gen/skill-call.ts";
import type { SkillCreateResult } from "../../protocol/gen/skill-create-result.ts";
import type { SkillListResult } from "../../protocol/gen/skill-list-result.ts";
import type { AgentsListResult } from "../../protocol/gen/agents-list-result.ts";
import type { AgentsCopyResult } from "../../protocol/gen/agents-copy-result.ts";
import type { AgentsDeleteResult } from "../../protocol/gen/agents-delete-result.ts";
import type { EvalEnded } from "../../protocol/gen/eval-ended.ts";
import type { EvalProgress } from "../../protocol/gen/eval-progress.ts";
import type { EvalStarted } from "../../protocol/gen/eval-started.ts";
import type { EvalsApplyResult } from "../../protocol/gen/evals-apply-result.ts";
import type { EvalsDeleteResult } from "../../protocol/gen/evals-delete-result.ts";
import type { EvalsGetResult } from "../../protocol/gen/evals-get-result.ts";
import type { EvalsListResult } from "../../protocol/gen/evals-list-result.ts";
import type { EvalsPlanResult } from "../../protocol/gen/evals-plan-result.ts";
import type { EvalsResumeResult } from "../../protocol/gen/evals-resume-result.ts";
import type { EvalsStartParams } from "../../protocol/gen/evals-start-params.ts";
import type { EvalsStartResult } from "../../protocol/gen/evals-start-result.ts";
import type { EvalsStopResult } from "../../protocol/gen/evals-stop-result.ts";
import type { AgentsKeepResult } from "../../protocol/gen/agents-keep-result.ts";
import type { AgentsSaveResult } from "../../protocol/gen/agents-save-result.ts";
import type { AgentsSetDefaultLimitsParams } from "../../protocol/gen/agents-set-default-limits-params.ts";
import type { AgentsSetLimitsResult } from "../../protocol/gen/agents-set-limits-result.ts";
import type { AgentsSetWishResult } from "../../protocol/gen/agents-set-wish-result.ts";
import type { SkillReadResult } from "../../protocol/gen/skill-read-result.ts";
import type { RoutineUpdateResult } from "../../protocol/gen/routine-update-result.ts";
import type { SkillSetDisabledResult } from "../../protocol/gen/skill-set-disabled-result.ts";
import type { SkillWriteResult } from "../../protocol/gen/skill-write-result.ts";
import type { McpToggleResult } from "../../protocol/gen/mcp-toggle-result.ts";
import type { SessionSetSkillsResult } from "../../protocol/gen/session-set-skills-result.ts";
import type { McpToolsResult } from "../../protocol/gen/mcp-tools-result.ts";
import type { McpCallResult } from "../../protocol/gen/mcp-call-result.ts";
import type { McpLogsResult } from "../../protocol/gen/mcp-logs-result.ts";
import type { McpServerLog } from "../../protocol/gen/mcp-server-log.ts";
import type { McpTestProgress } from "../../protocol/gen/mcp-test-progress.ts";
import type { McpTestResult } from "../../protocol/gen/mcp-test-result.ts";
import type { McpUpdateParams } from "../../protocol/gen/mcp-update-params.ts";
import type { ConfigRawGetResult } from "../../protocol/gen/config-raw-get-result.ts";
import type { ConfigRawResult } from "../../protocol/gen/config-raw-result.ts";
import type { McpImportApplyParams } from "../../protocol/gen/mcp-import-apply-params.ts";
import type { McpImportApplyResult } from "../../protocol/gen/mcp-import-apply-result.ts";
import type { McpImportScanResult } from "../../protocol/gen/mcp-import-scan-result.ts";
import type { MessageSendResult } from "../../protocol/gen/message-send-result.ts";
import type { ModelListResult } from "../../protocol/gen/model-list-result.ts";
import type { HfFilesResult } from "../../protocol/gen/hf-files-result.ts";
import type { HfSearchResult } from "../../protocol/gen/hf-search-result.ts";
import type { OllamaLibraryResult } from "../../protocol/gen/ollama-library-result.ts";
import type { ModelDeleteResult } from "../../protocol/gen/model-delete-result.ts";
import type { ModelProbeResult } from "../../protocol/gen/model-probe-result.ts";
import type { ModelBenchDone } from "../../protocol/gen/model-bench-done.ts";
import type { ModelBenchProgress } from "../../protocol/gen/model-bench-progress.ts";
import type { ModelBenchResult } from "../../protocol/gen/model-bench-result.ts";
import type { ModelCheckDone } from "../../protocol/gen/model-check-done.ts";
import type { ModelCheckProgress } from "../../protocol/gen/model-check-progress.ts";
import type { ModelCheckResult } from "../../protocol/gen/model-check-result.ts";
import type { ModelPullCancelResult } from "../../protocol/gen/model-pull-cancel-result.ts";
import type { ModelPullCleanupResult } from "../../protocol/gen/model-pull-cleanup-result.ts";
import type { ModelPullDone } from "../../protocol/gen/model-pull-done.ts";
import type { ModelPullProgress } from "../../protocol/gen/model-pull-progress.ts";
import type { ModelPullResult } from "../../protocol/gen/model-pull-result.ts";
import type { ModelScoreResetResult } from "../../protocol/gen/model-score-reset-result.ts";
import type { ModelSetDefaultResult } from "../../protocol/gen/model-set-default-result.ts";
import type { ModelStarResult } from "../../protocol/gen/model-star-result.ts";
import type { OllamaSettingsSetParams } from "../../protocol/gen/ollama-settings-set-params.ts";
import type { OllamaSettingsSetResult } from "../../protocol/gen/ollama-settings-set-result.ts";
import type { OllamaSettingsValues } from "../../protocol/gen/ollama-settings-values.ts";
import type { ModelOptionsGetResult } from "../../protocol/gen/model-options-get-result.ts";
import type { ModelOptionsSaved } from "../../protocol/gen/model-options-saved.ts";
import type { ModelOptionsSetResult } from "../../protocol/gen/model-options-set-result.ts";
import type { PermissionsSetModeParams } from "../../protocol/gen/permissions-set-mode-params.ts";
import type { PermissionsSetModeResult } from "../../protocol/gen/permissions-set-mode-result.ts";
import type { SessionCompactResult } from "../../protocol/gen/session-compact-result.ts";
import type { SessionSetChecksResult } from "../../protocol/gen/session-set-checks-result.ts";
import type { SessionSetRouteParams } from "../../protocol/gen/session-set-route-params.ts";
import type { SessionSetRouteResult } from "../../protocol/gen/session-set-route-result.ts";
import type { SessionSetPlanResult } from "../../protocol/gen/session-set-plan-result.ts";
import type { SessionSetModeParams } from "../../protocol/gen/session-set-mode-params.ts";
import type { SessionSetModeResult } from "../../protocol/gen/session-set-mode-result.ts";
import type { SessionSetOptionsResult } from "../../protocol/gen/session-set-options-result.ts";
import type { SessionSetModelResult } from "../../protocol/gen/session-set-model-result.ts";
import type { Params as ChatEvent } from "../../protocol/gen/rpc-notification.ts";
import type { RunCancelResult } from "../../protocol/gen/run-cancel-result.ts";
import type { HelperStopResult } from "../../protocol/gen/helper-stop-result.ts";
import type { HelpersRespondResult } from "../../protocol/gen/helpers-respond-result.ts";
import type { SessionAttachResult } from "../../protocol/gen/session-attach-result.ts";
import type { SessionCloseResult } from "../../protocol/gen/session-close-result.ts";
import type { SessionCreateResult } from "../../protocol/gen/session-create-result.ts";
import type { SessionForkResult } from "../../protocol/gen/session-fork-result.ts";
import type { SessionInspectResult } from "../../protocol/gen/session-inspect-result.ts";
import type { CostGetResult } from "../../protocol/gen/cost-get-result.ts";
import type { EvalRoutingResult } from "../../protocol/gen/eval-routing-result.ts";
import type { ChatSetParams } from "../../protocol/gen/chat-set-params.ts";
import type { ChatSetResult } from "../../protocol/gen/chat-set-result.ts";
import type { ChatValues } from "../../protocol/gen/chat-values.ts";
import type { ChatPromptParams } from "../../protocol/gen/chat-prompt-params.ts";
import type { ChatPromptResult } from "../../protocol/gen/chat-prompt-result.ts";
import type { ChatDraftResult } from "../../protocol/gen/chat-draft-result.ts";
import type { ChatSuggestionsResult } from "../../protocol/gen/chat-suggestions-result.ts";
import type { ChatSuggestionDismissResult } from "../../protocol/gen/chat-suggestion-dismiss-result.ts";
import type { NotificationsSetParams } from "../../protocol/gen/notifications-set-params.ts";
import type { NotificationsSetResult } from "../../protocol/gen/notifications-set-result.ts";
import type { NotificationsValues } from "../../protocol/gen/notifications-values.ts";
import type { NotifyTestResult } from "../../protocol/gen/notify-test-result.ts";
import type { RoutingGetResult } from "../../protocol/gen/routing-get-result.ts";
import type { RoutingSetParams } from "../../protocol/gen/routing-set-params.ts";
import type { RoutingSetResult } from "../../protocol/gen/routing-set-result.ts";
import type { TraceGetResult } from "../../protocol/gen/trace-get-result.ts";
import type { TraceSpanResult } from "../../protocol/gen/trace-span-result.ts";
import type { SessionListResult, SessionSummary } from "../../protocol/gen/session-list-result.ts";
import type { SessionRenameResult } from "../../protocol/gen/session-rename-result.ts";
import { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "../../protocol/gen/version.ts";
import { Attachments } from "./attachments.ts";
import { backoffDelayMs } from "./backoff.ts";
import {
  asChatEvent,
  isAuthListResult,
  isAuthRemoveResult,
  isAuthSetResult,
  isKeychainWait,
  isOllamaInstallDone,
  isMcpCatalogResult,
  isMcpServerDetail,
  isRuntimeInstallDone,
  isRuntimeName,
  isChangesCommitInfoResult,
  isChangesCommitResult,
  isChangesListResult,
  isChangesRevertResult,
  isFileListResult,
  isFileReadResult,
  isFsListDirsResult,
  isFsChooseFolderResult,
  isGitBranchesResult,
  isFsRevealResult,
  isGitInfoResult,
  isSetupStatusResult,
  isDaemonStatus,
  isHelloResult,
  isMcpListResult,
  isMcpLoginDone,
  isMcpLoginResult,
  isMcpRemoveResult,
  isMcpServer,
  isMcpToggleResult,
  isSessionSetSkillsResult,
  isConfigRawGetResult,
  isConfigRawResult,
  isMcpImportApplyResult,
  isMcpImportScanResult,
  isMcpCallResult,
  isMcpLogsResult,
  isMcpServerLog,
  isMcpTestProgress,
  isMcpTestResult,
  isMcpToolsResult,
  isMessageSendResult,
  isModelListResult,
  isHfFilesResult,
  isHfSearchResult,
  isOllamaLibraryResult,
  isModelProbeResult,
  isModelServerStatus,
  isModelOptionsGetResult,
  isModelOptionsSaved,
  isModelOptionsSetResult,
  isModelScoreResetResult,
  isModelSetDefaultResult,
  isModelStarResult,
  isOllamaSettingsSetResult,
  isOllamaSettingsValues,
  isPermissionsSetModeResult,
  isSessionCompactResult,
  isSessionSetChecksResult,
  isSessionSetRouteResult,
  isSessionSetPlanResult,
  isSessionSetModeResult,
  isSessionSetOptionsResult,
  isBenchDone,
  isBenchProgress,
  isCheckDone,
  isCheckProgress,
  isPullDone,
  isPullCleanupResult,
  isPullProgress,
  isRefResult,
  isDeviceListResult,
  isDevicePairBeginResult,
  isDevicePairChanged,
  isDevicePairConfirmResult,
  isDeviceRenameResult,
  isDeviceRevokeResult,
  isMemoryChanged,
  isMemoryDeleteResult,
  isMemoryExportResult,
  isMemoryGetResult,
  isMemoryListResult,
  isMemorySettingsResult,
  isMemoryUpdateResult,
  isMemoryWriteResult,
  isRoutineGetResult,
  isRoutineListResult,
  isRoutinePreviewResult,
  isRoutineRemoveResult,
  isRoutineRunResult,
  isRunListResult,
  isSkillCreateResult,
  isAgentsListResult,
  isAgentsCopyResult,
  isAgentsDeleteResult,
  isAgentsKeepResult,
  isEvalEnded,
  isEvalProgress,
  isEvalStarted,
  isEvalsApplyResult,
  isEvalsDeleteResult,
  isEvalsGetResult,
  isEvalsListResult,
  isEvalsPlanResult,
  isEvalsResumeResult,
  isEvalsStartResult,
  isEvalsStopResult,
  isAgentsSaveResult,
  isAgentsSetLimitsResult,
  isAgentsSetWishResult,
  isSkillListResult,
  isSkillReadResult,
  isRoutineUpdateResult,
  isSkillSetDisabledResult,
  isSkillWriteResult,
  isSessionSetModelResult,
  isPing,
  isRecord,
  isRunCancelResult,
  isHelperStopResult,
  isHelpersRespondResult,
  isSessionAttachResult,
  isSessionCloseResult,
  isSessionCreateResult,
  isSessionForkResult,
  isSessionInspectResult,
  isCostGetResult,
  isEvalRoutingResult,
  isChatSetResult,
  isChatPromptResult,
  isChatDraftResult,
  isChatSuggestionsResult,
  isChatSuggestionDismissResult,
  isChatValues,
  isNotificationsSetResult,
  isNotificationsValues,
  isNotifyTestResult,
  isRoutingGetResult,
  isRoutingSetResult,
  isTraceGetResult,
  isTraceSpanResult,
  isSessionListResult,
  isSessionRenameResult,
  isSessionSummary,
  isConfigGetResult,
} from "./guards.ts";
import { pushWire, type WireFrame, type WireLine } from "./wire.ts";
import { eventFrame, flat, outgoingDetail, resultDetail, shownParams, summaryFrame } from "./wire-detail.ts";

const PROTOCOL_MISMATCH = -32001;
export const SESSION_NOT_FOUND = -32003;
export const SESSION_BUSY = -32004;
export const MODEL_NOT_CONFIGURED = -32005;
/** `session.create` with a `branch` in a folder that is not a git repo. */
export const NOT_A_REPO = -32025;
/** `session.create` with a `branch` that git would not switch to. The message is git's own. */
export const BRANCH_SWITCH_FAILED = -32026;
export const RUN_NOT_FOUND = -32006;
export const MESSAGE_NOT_FOUND = -32007;
export const KEYCHAIN_UNAVAILABLE = -32008;
export const MODEL_PULL_FAILED = -32009;
export const APPROVAL_NOT_FOUND = -32010;
export const INVALID_TOOL_ARGS = -32011;
export const ARTIFACT_NOT_FOUND = -32012;
export const SKILL_NOT_FOUND = -32013;
/** The provider refused the key, and it was not stored. */
export const KEY_REJECTED = -32014;
/** The key could not be tried (no network, or an odd answer), and it was not stored. */
export const KEY_UNCHECKED = -32015;
/** Installing or starting Ollama failed. `data.no_brew` means Homebrew is missing. */
export const OLLAMA_FAILED = -32016;
/** A paid model was refused because a cap in `[budget]` is spent. The message says which and what to do. */
export const BUDGET_SPENT = -32017;
/** A chat in a local-only folder was refused a hosted model. The message says what to do. */
export const LOCAL_ONLY = -32018;

export type { ChatEvent, SessionSummary };
/** The web gateway closes a link with this code when its token is missing or wrong. Retrying cannot help. */
export const UNAUTHORIZED_CLOSE_CODE = 4401;
/** The gateway closes with this when its daemon is not running (ADR-028). */
export const DAEMON_DOWN_CLOSE_CODE = 1013;
const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;

export class RpcError extends Error {
  readonly code: number;

  /** The error's `data`, when the daemon sent an object. */
  readonly data: Record<string, unknown> | null;

  constructor(code: number, message: string, data: Record<string, unknown> | null = null) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export type ConnectionState =
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "reconnecting"; attempt: number; delayMs: number; closeCode?: number }
  | { status: "closed"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "unauthorized" };

interface ConnectBase {
  clientName: string;
  reconnect: boolean;
  heartbeatMs?: number;
  heartbeatTimeoutMs?: number;
  connectTimeoutMs?: number;
  backoff?: (attempt: number) => number;
}

/** `dial` opens the link to the daemon. `@golem/client/node` has one for a Unix socket. */
export type ConnectOptions = ConnectBase & { dial: Dial };

/** The limits to set (a number) and to clear (`clear`, by key) for `setAgentLimits` and `setDefaultAgentLimits`. */
export type AgentLimitsChange = AgentsSetDefaultLimitsParams;

export interface GolemClient {
  readonly state: ConnectionState;
  /** Whether the daemon said, in `hello`, that this page is on its own Mac and may open the folder dialog. False until connected. */
  readonly localUi: boolean;
  readonly ready: Promise<void>;
  onState(listener: (state: ConnectionState) => void): () => void;
  onEvent(listener: (event: ChatEvent) => void): () => void;
  /** Summaries from {@link GolemClient.watchSessions}: the list itself, then each change. */
  onSessionSummary(listener: (summary: SessionSummary) => void): () => void;
  onWire(listener: (lines: readonly WireLine[]) => void): () => void;
  status(): Promise<DaemonStatus>;
  /**
   * Create a session. Its events arrive only after {@link GolemClient.attachSession}.
   * `cwd` is its project folder, an absolute path. File tools work only inside it.
   * `branch` switches the folder to that git branch first (`createBranch` makes it); a refused switch is an error.
   */
  createSession(options?: { cwd?: string; modelProfile?: string; origin?: "user" | "cli"; branch?: string; createBranch?: boolean }): Promise<SessionCreateResult>;
  /**
   * Replay the session's events after `afterSeq`, then stream new ones.
   * The client attaches again after a reconnect, from the last `seq` it saw.
   */
  attachSession(sessionId: string, afterSeq?: number): Promise<SessionAttachResult>;
  detachSession(sessionId: string): Promise<void>;
  /** Open sessions, newest activity first. With `cwd`, only those in that project folder. */
  listSessions(limit?: number, cwd?: string): Promise<SessionListResult>;
  /**
   * Follow the session list. Every listed session, then every later change,
   * reaches {@link GolemClient.onSessionSummary}. After a reconnect the client
   * lists and watches again by itself. Merge with `mergeSummary`.
   */
  watchSessions(limit?: number): Promise<void>;
  /**
   * Copy a session's history up to `atMessageId` into a new session. Its events
   * arrive only after {@link GolemClient.attachSession}.
   */
  /** Hide the session from the list. Its events stay in the log. */
  closeSession(sessionId: string): Promise<SessionCloseResult>;
  /** Forks at a message, or at the last one without `atMessageId`. A helper may be the source: the fork is a chat of its own. */
  forkSession(sessionId: string, atMessageId?: string): Promise<SessionForkResult>;
  /** Set the title by hand. Resolves with the title as stored: one line, at most 60 characters. */
  renameSession(sessionId: string, title: string): Promise<SessionRenameResult>;
  /** `cwd` gives a session without a project folder this one. A session with a folder keeps its own. */
  /** With `skill`, the daemon runs that skill once and `text` is the line as typed. */
  sendMessage(sessionId: string, text: string, options?: SendOptions): Promise<MessageSendResult>;
  /** Stop a run. Resolves after `run.cancelled` is in the log; `cancelled` is false when it had ended. */
  cancelRun(runId: string): Promise<RunCancelResult>;
  /** `helper.stop`: cancel the run of a helper session. The lead goes on with `stopped: cancelled` as its result. */
  stopHelper(sessionId: string): Promise<HelperStopResult>;
  /** `helpers.respond`: answer "start these helpers?" (a `batch` pending item) for the `delegate` call `callId`. `run` false tells the model to do the work in the chat. */
  respondHelpers(sessionId: string, callId: string, run: boolean): Promise<HelpersRespondResult>;
  inspectSession(sessionId: string): Promise<SessionInspectResult>;
  /** A session's runs as a tree: run, then model call, then tool call. Oldest run first. */
  /** What model calls cost: today, the week, and with a session id that session. */
  getCost(sessionId?: string): Promise<CostGetResult>;
  /** What the recorded sessions of the last `days` days would have cost on each route. A calculation, no model call. */
  evalRouting(days?: number, sessionId?: string): Promise<EvalRoutingResult>;
  /** The routing, budget and context settings as golem uses them, and what it picks for an empty tier. */
  /** The defaults for every new chat, from `[chat]`. */
  getChat(): Promise<ChatValues>;
  setChat(params: ChatSetParams): Promise<ChatSetResult>;
  /** What the model of a new chat reads. With `instructions`, those lines stand in for the saved ones for this answer only. */
  getChatPrompt(params?: ChatPromptParams): Promise<ChatPromptResult>;
  /** Golem drafts instruction lines from what the person says about how they like answers. Nothing is saved. */
  draftChat(description: string): Promise<ChatDraftResult>;
  /** Lines suggested from the person's chats and memory. Answers with what is kept and starts the daily job. */
  getChatSuggestions(): Promise<ChatSuggestionsResult>;
  /** The line is never suggested again. */
  dismissChatSuggestion(line: string): Promise<ChatSuggestionDismissResult>;
  getNotifications(): Promise<NotificationsValues>;
  setNotifications(params: NotificationsSetParams): Promise<NotificationsSetResult>;
  notifyTest(): Promise<NotifyTestResult>;
  getRouting(): Promise<RoutingGetResult>;
  /**
   * Changes keys of the five routing tables in `config.toml`. A null removes a key. A wrong value is in the
   * result (`ok: false` with field errors) and writes nothing.
   */
  setRouting(params: RoutingSetParams): Promise<RoutingSetResult>;
  getTrace(sessionId: string): Promise<TraceGetResult>;
  /** The full input and output of one model or tool span, by the `id` that `getTrace` gave. */
  getTraceSpan(sessionId: string, spanId: string): Promise<TraceSpanResult>;
  /** Store a provider's API key in the daemon's credential store. The wire view shows it redacted. */
  /**
   * Store an API key. With `check` (the default), the daemon tries it against
   * the provider first and rejects it with {@link KEY_REJECTED} or
   * {@link KEY_UNCHECKED}; `models` is then how many models it opens.
   */
  setKey(provider: string, key: string, options?: { check?: boolean }): Promise<AuthSetResult>;
  removeKey(provider: string): Promise<AuthRemoveResult>;
  listKeys(): Promise<AuthListResult>;
  /** Resolved settings, and the tool rules for `cwd` in the order they are checked. */
  getConfig(cwd?: string, sessionId?: string): Promise<ConfigGetResult>;
  /** Answer the tool call the session's run waits on. The run goes on in the daemon. */
  /** `limit` characters of a session's artifact from `offset`, and the artifact's size. */
  readArtifact(sessionId: string, artifactId: string, offset?: number, limit?: number): Promise<ArtifactReadResult>;
  /** The files a session changed, each as its net change, with counts and flags only. */
  changesList(sessionId: string): Promise<ChangesListResult>;
  /** The diff of a file (`path`) or of one change (`changeId`). */
  changesDiff(sessionId: string, target: ChangesDiffTarget): Promise<ChangesDiffResult>;
  /**
   * Put back what a change, a file, a hunk or a turn wrote. A file that changed on disk is left
   * alone and listed in `conflicts`, unless `force`. Refused while the session has a run.
   */
  changesRevert(sessionId: string, target: ChangesRevertTarget, force?: boolean): Promise<ChangesRevertResult>;
  /** The start of one text file of the session's folder, with its line count. */
  readFile(sessionId: string, path: string): Promise<FileReadResult>;
  /** Files of the session's folder whose path holds `query`, shortest first. */
  listFiles(sessionId: string, query?: string, limit?: number, hidden?: boolean): Promise<FileListResult>;
  /** Commit `paths` of the session folder with the user's own git. Never pushes. */
  changesCommit(sessionId: string, paths: string[], message: string): Promise<ChangesCommitResult>;
  /** Whether the session folder is in a git work tree, its branch, and which of the changed files git sees. */
  changesCommitInfo(sessionId: string): Promise<ChangesCommitInfoResult>;
  /** A commit message the session's model suggests for `paths`. */
  changesSuggestMessage(sessionId: string, paths: string[]): Promise<ChangesSuggestMessageResult>;
  /** `args` are the call's arguments as the user edited them. They go only with `allow`. `scope: "batch"` answers for all the helpers of one delegate call, and not with `args`. */
  respondApproval(
    sessionId: string,
    callId: string,
    decision: ApprovalChoice,
    args?: Readonly<Record<string, unknown>>,
    scope?: "batch",
  ): Promise<ApprovalRespondResult>;
  /** Answer the paid step-up question a run waits on. The run goes on in the session's events. */
  answerConsent(sessionId: string, runId: string, answer: ConsentChoice): Promise<RouteConsentAnswerResult>;
  /** Set the action of rule `index` in the user's or the project's file. `cwd` names the project. */
  updateRule(
    target: "user" | "project",
    index: number,
    action: "allow" | "ask" | "deny",
    cwd?: string,
  ): Promise<PolicyEditResult>;
  /** Delete rule `index` from the user's or the project's file. */
  removeRule(target: "user" | "project", index: number, cwd?: string): Promise<PolicyEditResult>;
  /** Stop allowing `tool` (with `subject`) for the rest of the session. Resolves whether it was allowed. */
  revokeAllowance(sessionId: string, tool: string, subject: string | null): Promise<boolean>;
  /** Every model golem knows of. `refresh` fetches hosted lists and prices again, past their cache. */
  /** `refresh` asks the providers again, past the daemon's cache. `showAll` adds every live chat model that calls tools. */
  listModels(refresh?: boolean, showAll?: boolean): Promise<ModelListResult>;
  /** Use `model` (a profile or a ref) from the session's next run. The daemon emits `model.selected`. */
  setSessionModel(sessionId: string, model: string): Promise<SessionSetModelResult>;
  /** Write `default_model` to the user's config.toml. New sessions start on it. */
  /** Starts a model's score from nothing. Usage rows stay. */
  resetModelScore(ref: string): Promise<ModelScoreResetResult>;
  setDefaultModel(model: string): Promise<ModelSetDefaultResult>;
  /** Star `ref` for the model menu, or take its star away. The first change writes the whole list to `[model_menu] starred`. */
  starModel(ref: string, starred: boolean): Promise<ModelStarResult>;
  /** The `[ollama]` settings as golem uses them. `running` reads false until golem has looked for Ollama. */
  getOllamaSettings(): Promise<OllamaSettingsValues>;
  /** Changes the `[ollama]` keys sent. Nothing is written when a value is wrong. */
  setOllamaSettings(params: OllamaSettingsSetParams): Promise<OllamaSettingsSetResult>;
  /** Write `[permissions] mode` to the user's config.toml, keeping its comments. New chats start in it. */
  setDefaultPermissionMode(mode: PermissionsSetModeParams["mode"]): Promise<PermissionsSetModeResult>;
  /** The tunable options of a local model, its own defaults, what is saved for it, and `sessionId`'s overrides. */
  getModelOptions(model: string, sessionId?: string): Promise<ModelOptionsGetResult>;
  /** Save options for the model in config.toml. A `null` value removes one. Every connection gets `onOptionsSaved`. */
  setModelOptions(model: string, options: Record<string, number | string | null>): Promise<ModelOptionsSetResult>;
  /** Override options for one session from its next run. A `null` value removes one. The session stores `model.options.changed`. */
  setSessionOptions(sessionId: string, options: Record<string, number | string | null>): Promise<SessionSetOptionsResult>;
  /** Set the permission mode of one session, or `null` to follow config.toml again. The session stores `session.mode.changed`. */
  setSessionMode(sessionId: string, mode: SessionSetModeParams["mode"]): Promise<SessionSetModeResult>;
  /**
   * Clear old tool results, or summarise old turns, of an idle session, so the next call sends less.
   * `focus` is what a summary must keep. The call can take a minute with a local model. Nothing is deleted.
   */
  compactSession(sessionId: string, action: "clear" | "summarise" | "grow", focus?: string): Promise<SessionCompactResult>;
  /** Say whether golem may run the project's checks in one session. The session stores `session.checks.changed`. */
  setChecks(sessionId: string, on: boolean): Promise<SessionSetChecksResult>;
  /** Set how one session picks the model of each turn. The session stores `session.updated` with its `route`. */
  setRoute(sessionId: string, mode: SessionSetRouteParams["mode"]): Promise<SessionSetRouteResult>;
  /** Put one session in plan first, or take it out. Its runs then only read and end in `plan.proposed`. The session stores `session.plan.changed`. */
  setPlan(sessionId: string, on: boolean): Promise<SessionSetPlanResult>;
  /** `model.options.saved`: the options saved for a model changed, from any client. */
  onOptionsSaved(listener: (saved: ModelOptionsSaved) => void): () => void;
  /** Size, fit, and free disk for a local model before downloading it. */
  probeModel(name: string): Promise<ModelProbeResult>;
  /** Start downloading. Progress reaches {@link GolemClient.onPull} on every connection. */
  pullModel(name: string): Promise<ModelPullResult>;
  cancelPull(name: string): Promise<ModelPullCancelResult>;
  /** Remove the parts a failed download left on disk (the `leftover_gb` of its `done`). */
  cleanupPull(ref: string): Promise<ModelPullCleanupResult>;
  deleteModel(name: string): Promise<ModelDeleteResult>;
  /** Looks for GGUF repos on Hugging Face. Only the query leaves this Mac. */
  searchHf(query: string, limit?: number): Promise<HfSearchResult>;
  /** The sizes of one repo, each with a fit check for this Mac. */
  hfFiles(repo: string): Promise<HfFilesResult>;
  /** Names of the Ollama library that contain the query, with sizes and fit. An empty query lists them all. */
  ollamaLibrary(query: string): Promise<OllamaLibraryResult>;
  /** `model.pull.progress` and `model.pull.done`, from any client's download. */
  onPull(listener: (update: PullUpdate) => void): () => void;
  /** Start golem's tool-calling test on a model. Results reach {@link GolemClient.onCheck}. */
  checkModel(name: string): Promise<ModelCheckResult>;
  /** `model.check.progress` and `model.check.done`, from any client's check. */
  onCheck(listener: (update: CheckUpdate) => void): () => void;
  /**
   * Start the speed measurement of a local model at several calls at once. It answers at once;
   * rows reach {@link GolemClient.onBench}. A hosted model is refused with {@link MODEL_NOT_CONFIGURED}.
   */
  benchModel(ref: string, engine?: string): Promise<ModelBenchResult>;
  /** `model.bench.progress` and `model.bench.done`, from any client's measurement. */
  onBench(listener: (update: BenchUpdate) => void): () => void;
  /**
   * The MCP servers, with their state and tools. With `sessionId`, also the
   * servers of that session's trusted project, and whether each is on for it.
   */
  listMcp(sessionId?: string): Promise<McpListResult>;
  /** Turn an on-demand MCP server on for a session. Resolves with the servers it has on. */
  enableMcp(sessionId: string, name: string): Promise<McpToggleResult>;
  disableMcp(sessionId: string, name: string): Promise<McpToggleResult>;
  /** Pin skills for the whole session, or unpin them. Resolves with the pins, in pin order. */
  setSkills(sessionId: string, change: { pin?: string[]; unpin?: string[] }): Promise<SessionSetSkillsResult>;
  /** A running server's tools, with what each says it does. `sessionId` picks its project's server. */
  mcpTools(name: string, sessionId?: string): Promise<McpToolsResult>;
  /** Start a server again now. Resolves with its state, usually `starting`. */
  restartMcp(name: string, sessionId?: string): Promise<McpServer>;
  /** Start the sign-in of a hosted server: the address to open. It ends with `mcp.login.done` ({@link GolemClient.onMcpLoginDone}). */
  mcpLogin(name: string, sessionId?: string): Promise<McpLoginResult>;
  /** Delete a server's sign-in and stop it. Resolves with it as `needs_auth`. */
  mcpLogout(name: string, sessionId?: string): Promise<McpServer>;
  /** Write `enabled` into the file that names the server. It applies at once. */
  setMcpEnabled(name: string, enabled: boolean | "on_demand", sessionId?: string): Promise<McpServer>;
  /** Add `[mcp.<name>]` to the user's config and start the server. The wire view shows `token` redacted. */
  addMcpServer(params: McpAddParams): Promise<McpServer>;
  /** Remove `[mcp.<name>]` from the user's config, stop the server, and drop its stored token. */
  removeMcpServer(name: string): Promise<McpRemoveResult>;
  /** The servers golem offers, each with whether it can run here and whether it is already added. */
  mcpCatalog(sessionId?: string): Promise<McpCatalogResult>;
  /**
   * Start a saved server (`name`) or a draft (`config`), list its tools, and ping it, saving nothing. Each step
   * reaches `onProgress` as it starts and ends. `secrets` (by reference) are used for this test only.
   */
  mcpTest(
    params:
      | { name: string; sessionId?: string }
      | { config: McpServerConfig; secrets?: Record<string, string>; sessionId?: string }
      | { catalogId: string; inputs?: Record<string, string>; secrets?: Record<string, string>; name?: string; sessionId?: string },
    onProgress?: (progress: McpTestProgress) => void,
  ): Promise<McpTestResult>;
  /** The last lines of a server's log, oldest first. New lines reach {@link GolemClient.onMcpLog}. */
  mcpLogs(name: string, options?: { sessionId?: string; limit?: number }): Promise<McpLogsResult>;
  /** Run one tool of a running server for a person who pressed Run: no approval, no session record. */
  mcpCall(params: { name: string; tool: string; arguments?: Record<string, unknown>; sessionId?: string }): Promise<McpCallResult>;
  /** `mcp.server.log`: new log lines of any server, at most one batch every 250 ms. */
  onMcpLog(listener: (log: McpServerLog) => void): () => void;
  /** The text of `config.toml` (a trusted project's with `scope: "project"` and a session), and its `mtime_ns`. */
  configRawGet(options?: { scope?: "user" | "project"; sessionId?: string }): Promise<ConfigRawGetResult>;
  /**
   * Check a new text, and write it when the file is still at `baseMtimeNs`. `local` uses the terminal's write,
   * which may also change the protected sections (`config.raw.set_protected`).
   */
  configRawSet(
    params: { text: string; baseMtimeNs: number | null; scope?: "user" | "project"; sessionId?: string; dryRun?: boolean },
    options?: { local?: boolean },
  ): Promise<ConfigRawResult>;
  /** Find the servers other apps have, or read pasted JSON. Secret values stay in the daemon under `scan_id`. */
  scanMcpImport(params?: { sessionId?: string; text?: string }): Promise<McpImportScanResult>;
  /** Add the picked servers of a scan, once. The wire view shows `secrets` redacted. */
  applyMcpImport(params: McpImportApplyParams): Promise<McpImportApplyResult>;
  /** Replace `[mcp.<name>]` in the file that names it. Send a secret again only to change it. */
  updateMcpServer(params: McpUpdateParams): Promise<McpServer>;
  /** One server's status, its whole config (secrets as `keychain:mcp/…` references), and where it is written. */
  mcpGet(name: string, sessionId?: string): Promise<McpServerDetail>;
  /** Install Node or uv with Homebrew, run by the daemon. Output reaches {@link GolemClient.onRuntimeInstall}. */
  installRuntime(name: RuntimeName): Promise<RuntimeInstallResult>;
  cancelRuntimeInstall(name: RuntimeName): Promise<RuntimeInstallCancelResult>;
  /** `runtime.install.output` and `runtime.install.done`, from any client's install. */
  onRuntimeInstall(listener: (update: RuntimeInstallUpdate) => void): () => void;
  /** `mcp.server.status`: a server started, failed, or changed its tools. */
  onMcpStatus(listener: (server: McpServer) => void): () => void;
  /** `mcp.login.done`: a sign-in ended, from any client's `mcp.login`. */
  onMcpLoginDone(listener: (done: McpLoginDone) => void): () => void;
  /** `model.server.status`: a local model server such as Ollama started, failed, or stopped. */
  onModelServer(listener: (status: ModelServerStatus) => void): () => void;
  /**
   * The folders directly under `path`, for a folder picker. `path` is an absolute path under the
   * home folder; without one the home folder is listed. A path outside home is refused.
   */
  listDirs(path?: string): Promise<FsListDirsResult>;
  /** The repo `path` belongs to: its branch, how many files changed, and its worktrees. */
  gitInfo(path: string): Promise<GitInfoResult>;
  /** The local branches of the repo a folder belongs to, newest commit first. Read only. */
  gitBranches(path: string): Promise<GitBranchesResult>;
  /**
   * Opens the macOS folder dialog on the daemon's Mac, in `start` when given. Resolves with the
   * folder chosen, or a null path when the person cancelled. Refused when the dialog is not
   * offered here (see {@link GolemClient.localUi}).
   */
  chooseFolder(start?: string | null): Promise<FsChooseFolderResult>;
  /**
   * Opens `path` in Finder on the daemon's Mac. Refused when this page is not on that Mac
   * (see {@link GolemClient.localUi}).
   */
  reveal(path: string): Promise<FsRevealResult>;
  /** Every part of golem's setup, as `golem doctor` checks it. */
  setupStatus(): Promise<SetupStatusResult>;
  /** Install Ollama with Homebrew, run by the daemon. Output reaches {@link GolemClient.onOllamaInstall}. */
  installOllama(): Promise<OllamaInstallResult>;
  cancelOllamaInstall(): Promise<OllamaInstallCancelResult>;
  /** Start the local Ollama now. `running` is false when golem may not start it. */
  startOllama(): Promise<OllamaStartResult>;
  /** `ollama.install.output` and `ollama.install.done`, from any client's install. */
  onOllamaInstall(listener: (update: OllamaInstallUpdate) => void): () => void;
  /** `keychain.wait`: a Keychain read is waiting on macOS, most likely its dialog, or it ended. */
  onKeychainWait(listener: (wait: KeychainWait) => void): () => void;
  /**
   * The skills a session in `cwd` sees, highest source first, with the ones
   * that lost their name or are broken. Without `cwd`, only the user's.
   */
  listSkills(cwd?: string): Promise<SkillListResult>;
  /** `skill.read`: the `SKILL.md` of the skill called `name` that a session in `cwd` sees, with its path and `mtime_ns`. */
  readSkill(name: string, cwd?: string): Promise<SkillReadResult>;
  /**
   * `skill.create`: make `<folder>/<name>/SKILL.md`. `local` uses the terminal's call, which also writes
   * into a project that is not trusted yet (`skill.create_protected`).
   */
  createSkill(
    params: { name: string; scope: "user" | "project"; cwd?: string; description: string; modelInvocable?: boolean },
    options?: { local?: boolean },
  ): Promise<SkillCreateResult>;
  /**
   * `skill.write`: check `text` and write it over the `SKILL.md` at `path` when
   * the file is still as it was read (`baseMtimeNs`). `dryRun` only checks.
   * With `local`, a project skill is written even when the project is not
   * trusted (`skill.write_protected`).
   */
  writeSkill(
    params: { path: string; text: string; baseMtimeNs: number; cwd?: string; dryRun?: boolean },
    options?: { local?: boolean },
  ): Promise<SkillWriteResult>;
  /** `routine.list`: the user's routines, and those of the trusted project `folders`, with the next and last run of each. Also the lines of the files that did not parse. */
  listRoutines(folders?: string[]): Promise<RoutineListResult>;
  /** `run.list`: the newest runs, one per headless session (a routine's firing or a detached ask), newest first. `sessionId` asks for that session's row alone. */
  listRuns(options?: { limit?: number; sessionId?: string }): Promise<RunListResult>;
  /** `routine.get`: one routine with its recent runs. `folder` is the project it is in, or none for the user's. */
  getRoutine(name: string, folder?: string): Promise<RoutineGetResult>;
  /** `routine.run`: fire a routine now. It returns the run and the session it started. */
  runRoutine(name: string, folder?: string): Promise<RoutineRunResult>;
  /** `routine.update`: merge `fields` into the user's routine `name` in `config.toml`; a field set to null is removed. */
  updateRoutine(name: string, fields: Record<string, unknown>, options?: { create?: boolean }): Promise<RoutineUpdateResult>;
  /** `routine.preview`: the next three times a schedule fires, as ISO times. Rejects with the daemon's reason for a schedule that does not parse. */
  previewRoutine(schedule: string): Promise<RoutinePreviewResult>;
  /** `skill.set_disabled`: turn a skill off, or on again, in `config.toml`. */
  setSkillDisabled(name: string, disabled: boolean): Promise<SkillSetDisabledResult>;
  /**
   * `skill.registry.changed`: skills changed on disk. `root` is the folder
   * whose project skills changed, or `null` when every folder's did.
   */
  onSkillsChanged(listener: (root: string | null) => void): () => void;
  /** `agents.list`: the agent types a session in `cwd` sees. Without `cwd`, only the user's. */
  listAgents(cwd?: string): Promise<AgentsListResult>;
  /** `agents.set_wish`: set the model wish of an agent type. Resolves to the type as it is now. */
  setAgentWish(name: string, wish: string, cwd?: string): Promise<AgentsSetWishResult>;
  /** `agents.keep`: read how long a finished helper's steps are kept, or change `keep_days` and `keep_problem_days` (0 is for ever) and `use_helpers`. */
  agentsKeep(change?: { keep_days?: number; keep_problem_days?: number; use_helpers?: "when_needed" | "ask" | "never" }): Promise<AgentsKeepResult>;
  /**
   * `agents.set_limits`: set the limits sent for an agent type and clear the ones named in `clear`; a key in neither stays as it is.
   * A built-in type gets them in `[agents.<name>]` of `config.toml`, your own file in its front matter; a project agent is refused.
   * Resolves to the type as it is now.
   */
  setAgentLimits(name: string, change: AgentLimitsChange, cwd?: string): Promise<AgentsSetLimitsResult>;
  /** `agents.set_default_limits`: set or clear the limits in `[agents]` that bound every helper. Resolves to what `agents.keep` returns, with the limits in `values`. */
  setDefaultAgentLimits(change: AgentLimitsChange): Promise<AgentsKeepResult>;
  /**
   * `evals.plan`: what a measurement of the helper rules would run, and whether this Mac has room for each local arm.
   * It reads memory and calls no model. `arms` limits the plan to those arms; `models` maps an arm to the model to plan it with.
   */
  evalsPlan(arms?: string[], models?: Record<string, string>): Promise<EvalsPlanResult>;
  /**
   * `evals.start`: begin a measurement. It answers at once with the id; progress reaches {@link GolemClient.onEval}.
   * A refused start (one is already running, an arm does not fit) comes back as an RPC error.
   */
  evalsStart(params: EvalsStartParams): Promise<EvalsStartResult>;
  /** `evals.stop`: stop a running measurement and keep the runs done. `stopped` is false when it was not running. */
  evalsStop(id: string): Promise<EvalsStopResult>;
  /** `evals.resume`: play the runs a stopped measurement did not play. `allowTight` and `ownRisk` are asked for again. */
  evalsResume(id: string, allowTight?: boolean, ownRisk?: boolean): Promise<EvalsResumeResult>;
  /** `evals.list`: the measurements kept on this Mac, the newest first. */
  evalsList(): Promise<EvalsListResult>;
  /** `evals.get`: one measurement with its runs and its proposal. */
  evalsGet(id: string): Promise<EvalsGetResult>;
  /** `evals.apply`: write the measured numbers of a measurement to `[agents.delegate]`. Resolves with the values now in force. */
  evalsApply(id: string): Promise<EvalsApplyResult>;
  /** `evals.delete`: delete a measurement that is not running. */
  evalsDelete(id: string): Promise<EvalsDeleteResult>;
  /** `eval.started`, `eval.progress` and `eval.ended`, from any client's measurement. */
  onEval(listener: (update: EvalUpdate) => void): () => void;
  /** `agents.save`: save the whole text of a user agent file. `name` is the file it replaces; leave it out for a new agent. When `ok` is false nothing was saved and `problems` each carry a message and, for a frontmatter key, its line. */
  saveAgent(text: string, name?: string, cwd?: string): Promise<AgentsSaveResult>;
  /** `agents.copy`: copy the bundled agent `name` to the user's own agents, unchanged. Resolves to the new user agent. */
  copyAgent(name: string, cwd?: string): Promise<AgentsCopyResult>;
  /** `agents.delete`: remove the user's file of the agent `name`. `agent` is what the name means now (such as the bundled one), or null. */
  deleteAgent(name: string, cwd?: string): Promise<AgentsDeleteResult>;
  /** `agent.registry.changed`: agent files changed. `root` is the folder whose project agents changed, or `null` for every folder. */
  onAgentsChanged(listener: (root: string | null) => void): () => void;
  /** `routine.remove`: delete a user routine from `config.toml`. */
  removeRoutine(name: string): Promise<RoutineRemoveResult>;
  /**
   * `routine.changed`, `routine.fired` and `routine.finished`: the routines or their runs changed, so
   * a list or a history read before is stale. The listener is told which one arrived.
   */
  onRoutinesChanged(listener: (kind: "changed" | "fired" | "finished") => void): () => void;
  /** `memory.list`: memories, filtered and paged, with counts and the `[memory]` settings. */
  listMemories(params?: MemoryListParams): Promise<MemoryListResult>;
  /** `memory.get`: one memory with its sources. */
  getMemory(id: string): Promise<MemoryGetResult>;
  /** `memory.write`: write a memory of yours. It is kept at once. */
  writeMemory(params: MemoryWriteParams): Promise<MemoryWriteResult>;
  /** `memory.update`: edit a memory, or accept its changed sources. */
  updateMemory(params: MemoryUpdateParams): Promise<MemoryUpdateResult>;
  /** `memory.delete`: delete memories by id. There is no trash. */
  deleteMemories(ids: string[]): Promise<MemoryDeleteResult>;
  /** `memory.export`: the memories of a scope or a folder, as Markdown or JSON text. */
  exportMemories(params: MemoryExportParams): Promise<MemoryExportResult>;
  /** `memory.settings`: read `[memory]`, or set the privacy of one scope. `auto_keep` is read only. */
  memorySettings(change?: { scope: "you" | "project" | "history"; privacy: "chat" | "local" }): Promise<MemorySettingsResult>;
  /** `memory.changed`: a memory was made, edited, deleted, went stale or was resolved, so a list read before is stale. */
  onMemoryChanged(listener: (change: MemoryChanged) => void): () => void;
  /** `device.list`: every paired phone, revoked ones last. */
  deviceList(): Promise<DeviceListResult>;
  /** `device.pair.begin`: open a pairing. The result holds the `golem://pair` link for the QR code. It fails when no relay is set. */
  devicePairBegin(): Promise<DevicePairBeginResult>;
  /** `device.pair.confirm`: the owner compared the words. `accept` false refuses the phone, or cancels a pairing nobody joined. */
  devicePairConfirm(pair: string, accept?: boolean): Promise<DevicePairConfirmResult>;
  /** `device.rename`. */
  deviceRename(device: string, name: string): Promise<DeviceRenameResult>;
  /** `device.revoke`: cut a phone off. Its "Always allow" rules stay, and come back in `rules`. */
  deviceRevoke(device: string): Promise<DeviceRevokeResult>;
  /** `device.pair.changed`: a pairing moved on (the words to compare, paired, or ended). */
  onDevicePairChanged(listener: (change: DevicePairChanged) => void): () => void;
  /** `device.changed`: a phone was paired, renamed, or revoked, so a list read before is stale. */
  onDevicesChanged(listener: () => void): () => void;
  /** Ping the daemon now, with the heartbeat's timeout. A dead link then closes and reconnects. Does nothing unless the link is open. */
  checkNow(): void;
  close(): void;
}

export type OllamaInstallUpdate =
  | { kind: "output"; text: string }
  | { kind: "done"; done: OllamaInstallDone };

export type RuntimeInstallUpdate =
  | { kind: "output"; name: RuntimeName; text: string }
  | { kind: "done"; done: RuntimeInstallDone };

export type PullUpdate =
  | { kind: "progress"; progress: ModelPullProgress }
  | { kind: "done"; done: ModelPullDone };

export type CheckUpdate =
  | { kind: "progress"; progress: ModelCheckProgress }
  | { kind: "done"; done: ModelCheckDone };

export type BenchUpdate =
  | { kind: "progress"; progress: ModelBenchProgress }
  | { kind: "done"; done: ModelBenchDone };

export type EvalUpdate =
  | { kind: "started"; started: EvalStarted }
  | { kind: "progress"; progress: EvalProgress }
  | { kind: "ended"; ended: EvalEnded };

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function policyEdit(result: unknown): PolicyEditResult {
  if (!isRecord(result) || typeof result["file"] !== "string") {
    throw new Error("invalid policy edit result");
  }
  return { file: result["file"] };
}

function withSession(params: Record<string, unknown>, sessionId: string | undefined): Record<string, unknown> {
  return sessionId === undefined ? params : { ...params, session_id: sessionId };
}

export function connectGolem(options: ConnectOptions): GolemClient {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const backoff = options.backoff ?? backoffDelayMs;
  const dial: Dial = options.dial;

  let state: ConnectionState = { status: "connecting" };
  let localUi = false;
  const listeners = new Set<(next: ConnectionState) => void>();
  const eventListeners = new Set<(event: ChatEvent) => void>();
  const summaryListeners = new Set<(summary: SessionSummary) => void>();
  const wireListeners = new Set<(lines: readonly WireLine[]) => void>();
  const pullListeners = new Set<(update: PullUpdate) => void>();
  const checkListeners = new Set<(update: CheckUpdate) => void>();
  const benchListeners = new Set<(update: BenchUpdate) => void>();
  const evalListeners = new Set<(update: EvalUpdate) => void>();
  const mcpListeners = new Set<(server: McpServer) => void>();
  const loginListeners = new Set<(done: McpLoginDone) => void>();
  const testListeners = new Set<(progress: McpTestProgress) => void>();
  const logListeners = new Set<(log: McpServerLog) => void>();
  const skillListeners = new Set<(root: string | null) => void>();
  const agentListeners = new Set<(root: string | null) => void>();
  const routineListeners = new Set<(kind: "changed" | "fired" | "finished") => void>();
  const memoryListeners = new Set<(change: MemoryChanged) => void>();
  const pairListeners = new Set<(change: DevicePairChanged) => void>();
  const deviceListeners = new Set<() => void>();
  const serverListeners = new Set<(status: ModelServerStatus) => void>();
  const optionsSavedListeners = new Set<(saved: ModelOptionsSaved) => void>();
  const installListeners = new Set<(update: OllamaInstallUpdate) => void>();
  const runtimeListeners = new Set<(update: RuntimeInstallUpdate) => void>();
  const keychainListeners = new Set<(wait: KeychainWait) => void>();
  const pending = new Map<number, Pending>();
  const attachments = new Attachments();
  let watching = false;
  let watchLimit: number | undefined;
  let wire: WireLine[] = [];
  let nextId = 1;
  let generation = 0;
  let attempt = 0;
  let link: Link | undefined;
  let open = false;
  let userClosed = false;
  let rejected = false;
  let readySettled = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A caller that never awaits `ready` (the web page watches the state instead) must not see an
  // unhandled rejection. Every await of `ready` still gets the error.
  ready.catch(() => undefined);

  function setState(next: ConnectionState): void {
    state = next;
    for (const listener of listeners) {
      listener(next);
    }
  }

  function settleReady(): void {
    if (readySettled) {
      return;
    }
    readySettled = true;
    resolveReady();
  }

  function failReady(error: Error): void {
    if (readySettled) {
      return;
    }
    readySettled = true;
    rejectReady(error);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  }

  function rejectPending(error: Error): void {
    for (const waiter of pending.values()) {
      waiter.reject(error);
    }
    pending.clear();
  }

  function record(frame: WireFrame): void {
    wire = pushWire(wire, frame);
    for (const listener of wireListeners) {
      try {
        listener(wire);
      } catch {
        // A listener must not tear the socket down.
      }
    }
  }

  async function mcpServerCall(method: string, params: Record<string, unknown>): Promise<McpServer> {
    await ready;
    const result = await call(method, params);
    if (!isMcpServer(result)) {
      throw new Error(`invalid ${method} result`);
    }
    return result;
  }

  async function toggleMcp(method: "mcp.enable" | "mcp.disable", sessionId: string, name: string) {
    await ready;
    const result = await call(method, { session_id: sessionId, name });
    if (!isMcpToggleResult(result)) {
      throw new Error(`invalid ${method} result`);
    }
    return result;
  }

  function call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const current = link;
    if (current === undefined || !open) {
      return Promise.reject(new Error("not connected"));
    }
    const id = nextId;
    nextId += 1;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params, id });
    const shown = JSON.stringify({ jsonrpc: "2.0", method, params: shownParams(method, params), id });
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      record({
        direction: "out",
        kind: method === "ping" ? "ping" : method,
        detail: outgoingDetail(method, params),
        json: method === "ping" ? "" : shown,
      });
      current.send(payload);
    });
  }

  function handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      record({ direction: "in", kind: "invalid json" });
      link?.close(new Error("invalid json"));
      return;
    }
    if (isRecord(message) && message["method"] === "event") {
      record({ ...eventFrame(message["params"]), json: line });
      const event = asChatEvent(message["params"]);
      if (event !== undefined && attachments.accept(event)) {
        for (const listener of eventListeners) {
          try {
            listener(event);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && (message["method"] === "model.pull.progress" || message["method"] === "model.pull.done")) {
      const params = message["params"];
      const ref = isRecord(params) && typeof params["ref"] === "string" ? params["ref"] : "";
      record({ direction: "in", kind: message["method"], detail: ref, json: line });
      let update: PullUpdate | undefined;
      if (message["method"] === "model.pull.progress" && isPullProgress(params)) {
        update = { kind: "progress", progress: params };
      } else if (message["method"] === "model.pull.done" && isPullDone(params)) {
        update = { kind: "done", done: params };
      }
      if (update !== undefined) {
        for (const listener of pullListeners) {
          try {
            listener(update);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && (message["method"] === "model.check.progress" || message["method"] === "model.check.done")) {
      const params = message["params"];
      const ref = isRecord(params) && typeof params["ref"] === "string" ? params["ref"] : "";
      record({ direction: "in", kind: message["method"], detail: ref, json: line });
      let update: CheckUpdate | undefined;
      if (message["method"] === "model.check.progress" && isCheckProgress(params)) {
        update = { kind: "progress", progress: params };
      } else if (message["method"] === "model.check.done" && isCheckDone(params)) {
        update = { kind: "done", done: params };
      }
      if (update !== undefined) {
        for (const listener of checkListeners) {
          try {
            listener(update);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && (message["method"] === "eval.started" || message["method"] === "eval.progress" || message["method"] === "eval.ended")) {
      const params = message["params"];
      const id = isRecord(params) && typeof params["id"] === "string" ? params["id"] : "";
      record({ direction: "in", kind: message["method"], detail: id, json: line });
      let update: EvalUpdate | undefined;
      if (message["method"] === "eval.started" && isEvalStarted(params)) {
        update = { kind: "started", started: params };
      } else if (message["method"] === "eval.progress" && isEvalProgress(params)) {
        update = { kind: "progress", progress: params };
      } else if (message["method"] === "eval.ended" && isEvalEnded(params)) {
        update = { kind: "ended", ended: params };
      }
      if (update !== undefined) {
        for (const listener of evalListeners) {
          try {
            listener(update);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && (message["method"] === "model.bench.progress" || message["method"] === "model.bench.done")) {
      const params = message["params"];
      const ref = isRecord(params) && typeof params["ref"] === "string" ? params["ref"] : "";
      record({ direction: "in", kind: message["method"], detail: ref, json: line });
      let update: BenchUpdate | undefined;
      if (message["method"] === "model.bench.progress" && isBenchProgress(params)) {
        update = { kind: "progress", progress: params };
      } else if (message["method"] === "model.bench.done" && isBenchDone(params)) {
        update = { kind: "done", done: params };
      }
      if (update !== undefined) {
        for (const listener of benchListeners) {
          try {
            listener(update);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "mcp.test.progress") {
      const params = message["params"];
      record({ direction: "in", kind: "mcp.test.progress", detail: isMcpTestProgress(params) ? params.step : "", json: line });
      if (isMcpTestProgress(params)) {
        for (const listener of testListeners) {
          try {
            listener(params);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "mcp.server.log") {
      const params = message["params"];
      record({ direction: "in", kind: "mcp.server.log", detail: isMcpServerLog(params) ? params.name : "", json: line });
      if (isMcpServerLog(params)) {
        for (const listener of logListeners) {
          try {
            listener(params);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "mcp.server.status") {
      const params = message["params"];
      const name = isRecord(params) && typeof params["name"] === "string" ? params["name"] : "";
      record({ direction: "in", kind: "mcp.server.status", detail: name, json: line });
      if (isMcpServer(params)) {
        for (const listener of mcpListeners) {
          try {
            listener(params);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "mcp.login.done") {
      const params = message["params"];
      const name = isRecord(params) && typeof params["name"] === "string" ? params["name"] : "";
      record({ direction: "in", kind: "mcp.login.done", detail: name, json: line });
      if (isMcpLoginDone(params)) {
        for (const listener of loginListeners) {
          try {
            listener(params);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "keychain.wait") {
      const params = message["params"];
      record({ direction: "in", kind: "keychain.wait", detail: "", json: line });
      if (isKeychainWait(params)) {
        for (const listener of keychainListeners) {
          try {
            listener(params);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (
      isRecord(message) &&
      (message["method"] === "ollama.install.output" || message["method"] === "ollama.install.done")
    ) {
      const params = message["params"];
      record({ direction: "in", kind: message["method"], detail: "", json: line });
      let update: OllamaInstallUpdate | undefined;
      if (message["method"] === "ollama.install.output" && isRecord(params) && typeof params["text"] === "string") {
        update = { kind: "output", text: params["text"] };
      } else if (message["method"] === "ollama.install.done" && isOllamaInstallDone(params)) {
        update = { kind: "done", done: params };
      }
      if (update !== undefined) {
        for (const listener of installListeners) {
          try {
            listener(update);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (
      isRecord(message) &&
      (message["method"] === "runtime.install.output" || message["method"] === "runtime.install.done")
    ) {
      const params = message["params"];
      record({ direction: "in", kind: message["method"], detail: "", json: line });
      let update: RuntimeInstallUpdate | undefined;
      if (
        message["method"] === "runtime.install.output" &&
        isRecord(params) &&
        isRuntimeName(params["name"]) &&
        typeof params["text"] === "string"
      ) {
        update = { kind: "output", name: params["name"], text: params["text"] };
      } else if (message["method"] === "runtime.install.done" && isRuntimeInstallDone(params)) {
        update = { kind: "done", done: params };
      }
      if (update !== undefined) {
        for (const listener of runtimeListeners) {
          try {
            listener(update);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "model.options.saved") {
      const params = message["params"];
      record({ direction: "in", kind: "model.options.saved", detail: isModelOptionsSaved(params) ? params.model : "", json: line });
      if (isModelOptionsSaved(params)) {
        for (const listener of optionsSavedListeners) {
          try {
            listener(params);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "model.server.status") {
      const params = message["params"];
      const detail = isModelServerStatus(params) ? `${params.provider} ${params.state}` : "";
      record({ direction: "in", kind: "model.server.status", detail, json: line });
      if (isModelServerStatus(params)) {
        for (const listener of serverListeners) {
          try {
            listener(params);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "agent.registry.changed") {
      const params = message["params"];
      const root = isRecord(params) && typeof params["root"] === "string" ? params["root"] : null;
      record({ direction: "in", kind: "agent.registry.changed", detail: root ?? "all", json: line });
      for (const listener of agentListeners) {
        try {
          listener(root);
        } catch {
          // A listener must not tear the socket down.
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "skill.registry.changed") {
      const params = message["params"];
      const root = isRecord(params) && typeof params["root"] === "string" ? params["root"] : null;
      record({ direction: "in", kind: "skill.registry.changed", detail: root ?? "all", json: line });
      for (const listener of skillListeners) {
        try {
          listener(root);
        } catch {
          // A listener must not tear the socket down.
        }
      }
      return;
    }
    if (
      isRecord(message) &&
      (message["method"] === "routine.changed" || message["method"] === "routine.fired" || message["method"] === "routine.finished")
    ) {
      const kind = message["method"].slice("routine.".length) as "changed" | "fired" | "finished";
      record({ direction: "in", kind: message["method"], detail: kind, json: line });
      for (const listener of routineListeners) {
        try {
          listener(kind);
        } catch {
          // A listener must not tear the socket down.
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "device.pair.changed") {
      const params = message["params"];
      // The words are for the owner to read aloud, not for a log: record the state only.
      record({ direction: "in", kind: "device.pair.changed", detail: isDevicePairChanged(params) ? params.state : "", json: line.replace(/"words":\[[^\]]*\]/, '"words":[…]') });
      if (isDevicePairChanged(params)) {
        for (const listener of pairListeners) {
          try {
            listener(params);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "device.changed") {
      record({ direction: "in", kind: "device.changed", detail: "", json: line });
      for (const listener of deviceListeners) {
        try {
          listener();
        } catch {
          // A listener must not tear the socket down.
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "memory.changed") {
      const params = message["params"];
      record({ direction: "in", kind: "memory.changed", detail: isMemoryChanged(params) ? `${params.change} ${params.id}` : "", json: line });
      if (isMemoryChanged(params)) {
        for (const listener of memoryListeners) {
          try {
            listener(params);
          } catch {
            // A listener must not tear the socket down.
          }
        }
      }
      return;
    }
    if (isRecord(message) && message["method"] === "session.summary") {
      record({ ...summaryFrame(message["params"]), json: line });
      if (isSessionSummary(message["params"])) {
        emitSummary(message["params"]);
      }
      return;
    }
    if (!isRecord(message) || message["id"] === undefined || message["id"] === null) {
      return;
    }
    const id = message["id"];
    if (typeof id !== "number") {
      return;
    }
    const waiter = pending.get(id);
    if (waiter === undefined) {
      return;
    }
    pending.delete(id);
    const errorBody = message["error"];
    if (isRecord(errorBody)) {
      record({
        direction: "in",
        kind: `${waiter.method} error`,
        detail: typeof errorBody["message"] === "string" ? flat(errorBody["message"]) : "",
        json: line,
      });
      const code = typeof errorBody["code"] === "number" ? errorBody["code"] : -1;
      const text = typeof errorBody["message"] === "string" ? errorBody["message"] : "rpc error";
      const data = isRecord(errorBody["data"]) ? errorBody["data"] : null;
      const error = new RpcError(code, text, data);
      if (code === PROTOCOL_MISMATCH) {
        rejected = true;
        setState({ status: "rejected", reason: text });
        failReady(error);
        link?.close();
      }
      waiter.reject(error);
      return;
    }
    record({
      direction: "in",
      kind: waiter.method === "ping" ? "ping" : waiter.method,
      detail: resultDetail(waiter.method, message["result"]),
      json: waiter.method === "ping" ? "" : line,
    });
    waiter.resolve(message["result"]);
  }

  function emitSummary(summary: SessionSummary): void {
    for (const listener of summaryListeners) {
      try {
        listener(summary);
      } catch {
        // A listener must not tear the socket down.
      }
    }
  }

  async function watch(limit: number | undefined): Promise<void> {
    const params: Record<string, unknown> = limit === undefined ? { watch: true } : { watch: true, limit };
    const result = await call("session.list", params);
    if (!isSessionListResult(result)) {
      throw new Error("invalid session.list result");
    }
    for (const summary of result.sessions) {
      emitSummary(summary);
    }
  }

  function onLinkClosed(error: Error | undefined, code?: number): void {
    stopHeartbeat();
    if (connectTimer !== undefined) {
      clearTimeout(connectTimer);
      connectTimer = undefined;
    }
    rejectPending(error ?? new Error("connection closed"));
    if (userClosed) {
      setState({ status: "closed", reason: "closed" });
      return;
    }
    if (code === UNAUTHORIZED_CLOSE_CODE) {
      setState({ status: "unauthorized" });
      failReady(new Error("unauthorized"));
      return;
    }
    if (rejected) {
      return;
    }
    const reason = error?.message ?? "connection closed";
    if (!options.reconnect) {
      setState({ status: "closed", reason });
      failReady(new Error(reason));
      return;
    }
    attempt += 1;
    const delayMs = backoff(attempt);
    setState(
      code === undefined
        ? { status: "reconnecting", attempt, delayMs }
        : { status: "reconnecting", attempt, delayMs, closeCode: code },
    );
    reconnectTimer = setTimeout(() => {
      openLink();
    }, delayMs);
  }

  async function reattach(watching: boolean): Promise<void> {
    await Promise.all([
      ...(watching ? [watch(watchLimit)] : []),
      ...attachments.entries().map(async ([sessionId, afterSeq]) => {
        try {
          await call("session.attach", { session_id: sessionId, after_seq: afterSeq });
        } catch (error) {
          if (!(error instanceof RpcError) || error.code !== SESSION_NOT_FOUND) {
            throw error;
          }
          attachments.untrack(sessionId);
        }
      }),
    ]);
  }

  /** One ping on `current`. A late or wrong answer closes the link, and the close reconnects. */
  function ping(current: Link, gen: number): void {
    if (gen !== generation || !open) {
      return;
    }
    const nonce = globalThis.crypto.randomUUID();
    const timeout = setTimeout(() => {
      current.close(new Error("heartbeat timeout"));
    }, heartbeatTimeoutMs);
    void call("ping", { nonce })
      .then((result) => {
        clearTimeout(timeout);
        if (!isPing(result) || result.nonce !== nonce) {
          current.close(new Error("heartbeat nonce mismatch"));
        }
      })
      .catch(() => {
        clearTimeout(timeout);
      });
  }

  function startHeartbeat(current: Link, gen: number): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      ping(current, gen);
    }, heartbeatMs);
  }

  function openLink(): void {
    const gen = ++generation;
    const current = dial();
    link = current;
    open = false;
    connectTimer = setTimeout(() => {
      current.close(new Error("timed out"));
    }, connectTimeoutMs);

    current.onLine((line) => {
      if (gen === generation) {
        handleLine(line);
      }
    });
    current.onClose((error, code) => {
      if (gen !== generation) {
        return;
      }
      open = false;
      onLinkClosed(error, code);
    });
    current.onOpen(() => {
      if (gen !== generation) {
        return;
      }
      open = true;
      void call("hello", {
        protocol_major: PROTOCOL_MAJOR,
        protocol_minor: PROTOCOL_MINOR,
        client: options.clientName,
      })
        .then(async (result) => {
          if (gen !== generation) {
            return;
          }
          if (!isHelloResult(result) || result.protocol_major !== PROTOCOL_MAJOR) {
            const daemonMajor = isHelloResult(result) ? result.protocol_major : "unknown";
            const reason = `protocol major mismatch: client ${PROTOCOL_MAJOR}, daemon ${daemonMajor}`;
            rejected = true;
            setState({ status: "rejected", reason });
            failReady(new Error(reason));
            current.close();
            return;
          }
          localUi = result.local_ui === true;
          if (connectTimer !== undefined) {
            clearTimeout(connectTimer);
            connectTimer = undefined;
          }
          await reattach(watching);
          if (gen !== generation) {
            return;
          }
          attempt = 0;
          setState({ status: "connected" });
          settleReady();
          startHeartbeat(current, gen);
        })
        .catch(() => {
          // The close handler reconnects, or records a protocol rejection.
          // A reattach that failed for another reason drops the socket and retries.
          if (gen === generation && !rejected) {
            current.close();
          }
        });
    });
  }

  openLink();

  return {
    get state() {
      return state;
    },
    get localUi() {
      return localUi;
    },
    ready,
    checkNow(): void {
      if (link !== undefined && open) {
        ping(link, generation);
      }
    },
    onState(listener: (next: ConnectionState) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onEvent(listener: (event: ChatEvent) => void): () => void {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    onSessionSummary(listener: (summary: SessionSummary) => void): () => void {
      summaryListeners.add(listener);
      return () => {
        summaryListeners.delete(listener);
      };
    },
    onWire(listener: (lines: readonly WireLine[]) => void): () => void {
      wireListeners.add(listener);
      listener(wire);
      return () => {
        wireListeners.delete(listener);
      };
    },
    async status(): Promise<DaemonStatus> {
      await ready;
      const result = await call("daemon.status", {});
      if (!isDaemonStatus(result)) {
        throw new Error("invalid daemon.status result");
      }
      return result;
    },
    async createSession(options?: { cwd?: string; modelProfile?: string; origin?: "user" | "cli"; branch?: string; createBranch?: boolean }): Promise<SessionCreateResult> {
      await ready;
      const params: { cwd?: string; model_profile?: string; origin?: string; branch?: string; create_branch?: boolean } = {};
      if (options?.cwd !== undefined) params.cwd = options.cwd;
      if (options?.modelProfile !== undefined) params.model_profile = options.modelProfile;
      if (options?.origin !== undefined) params.origin = options.origin;
      if (options?.branch !== undefined) params.branch = options.branch;
      if (options?.createBranch === true) params.create_branch = true;
      const result = await call("session.create", params);
      if (!isSessionCreateResult(result)) {
        throw new Error("invalid session.create result");
      }
      return result;
    },
    async attachSession(sessionId: string, afterSeq = 0): Promise<SessionAttachResult> {
      await ready;
      const followed = attachments.seen(sessionId) !== undefined;
      attachments.track(sessionId, afterSeq);
      let result: unknown;
      try {
        result = await call("session.attach", {
          session_id: sessionId,
          after_seq: attachments.seen(sessionId),
        });
      } catch (error) {
        if (!followed) {
          attachments.untrack(sessionId);
        }
        throw error;
      }
      if (!isSessionAttachResult(result)) {
        throw new Error("invalid session.attach result");
      }
      return result;
    },
    async detachSession(sessionId: string): Promise<void> {
      // Stop following at once. If the call fails because the link is down, the daemon has
      // dropped the attachment anyway, and a later attach must replay from the start.
      attachments.untrack(sessionId);
      await ready;
      if (attachments.seen(sessionId) !== undefined) {
        // Attached again while this waited: detaching now would cut the new attachment.
        return;
      }
      await call("session.detach", { session_id: sessionId });
    },
    async listSessions(limit?: number, cwd?: string): Promise<SessionListResult> {
      await ready;
      const result = await call("session.list", {
        ...(limit === undefined ? {} : { limit }),
        ...(cwd === undefined ? {} : { cwd }),
      });
      if (!isSessionListResult(result)) {
        throw new Error("invalid session.list result");
      }
      return result;
    },
    async watchSessions(limit?: number): Promise<void> {
      await ready;
      watchLimit = limit;
      watching = true;
      await watch(limit);
    },
    async closeSession(sessionId: string): Promise<SessionCloseResult> {
      await ready;
      const result = await call("session.close", { session_id: sessionId });
      if (!isSessionCloseResult(result)) {
        throw new Error("invalid session.close result");
      }
      return result;
    },
    async forkSession(sessionId: string, atMessageId?: string): Promise<SessionForkResult> {
      await ready;
      const result = await call(
        "session.fork",
        atMessageId === undefined ? { session_id: sessionId } : { session_id: sessionId, at_message_id: atMessageId },
      );
      if (!isSessionForkResult(result)) {
        throw new Error("invalid session.fork result");
      }
      return result;
    },
    async renameSession(sessionId: string, title: string): Promise<SessionRenameResult> {
      await ready;
      const result = await call("session.rename", { session_id: sessionId, title });
      if (!isSessionRenameResult(result)) {
        throw new Error("invalid session.rename result");
      }
      return result;
    },
    async sendMessage(sessionId: string, text: string, options?: SendOptions): Promise<MessageSendResult> {
      await ready;
      const params: Record<string, unknown> = { session_id: sessionId, text };
      if (options?.cwd !== undefined) {
        params["cwd"] = options.cwd;
      }
      if (options?.skill !== undefined) {
        params["skill"] = options.skill;
      }
      if (options?.stronger === true) {
        params["stronger"] = true;
      }
      const result = await call("message.send", params);
      if (!isMessageSendResult(result)) {
        throw new Error("invalid message.send result");
      }
      return result;
    },
    async cancelRun(runId: string): Promise<RunCancelResult> {
      await ready;
      const result = await call("run.cancel", { run_id: runId });
      if (!isRunCancelResult(result)) {
        throw new Error("invalid run.cancel result");
      }
      return result;
    },
    async stopHelper(sessionId: string): Promise<HelperStopResult> {
      await ready;
      const result = await call("helper.stop", { session_id: sessionId });
      if (!isHelperStopResult(result)) {
        throw new Error("invalid helper.stop result");
      }
      return result;
    },
    async respondHelpers(sessionId: string, callId: string, run: boolean): Promise<HelpersRespondResult> {
      await ready;
      const result = await call("helpers.respond", { session_id: sessionId, call_id: callId, run });
      if (!isHelpersRespondResult(result)) {
        throw new Error("invalid helpers.respond result");
      }
      return result;
    },
    async inspectSession(sessionId: string): Promise<SessionInspectResult> {
      await ready;
      const result = await call("session.inspect", { session_id: sessionId });
      if (!isSessionInspectResult(result)) {
        throw new Error("invalid session.inspect result");
      }
      return result;
    },
    async getCost(sessionId?: string): Promise<CostGetResult> {
      await ready;
      const result = await call("cost.get", sessionId === undefined ? {} : { session_id: sessionId });
      if (!isCostGetResult(result)) {
        throw new Error("invalid cost.get result");
      }
      return result;
    },
    async evalRouting(days?: number, sessionId?: string): Promise<EvalRoutingResult> {
      await ready;
      const params: Record<string, unknown> = {};
      if (days !== undefined) params["days"] = days;
      if (sessionId !== undefined) params["session_id"] = sessionId;
      const result = await call("eval.routing", params);
      if (!isEvalRoutingResult(result)) {
        throw new Error("invalid eval.routing result");
      }
      return result;
    },
    async getChat(): Promise<ChatValues> {
      await ready;
      const result = await call("chat.get", {});
      if (!isChatValues(result)) {
        throw new Error("invalid chat.get result");
      }
      return result;
    },
    async setChat(params: ChatSetParams): Promise<ChatSetResult> {
      await ready;
      const result = await call("chat.set", { ...params });
      if (!isChatSetResult(result)) {
        throw new Error("invalid chat.set result");
      }
      return result;
    },
    async getChatPrompt(params: ChatPromptParams = {}): Promise<ChatPromptResult> {
      await ready;
      const result = await call("chat.prompt", { ...params });
      if (!isChatPromptResult(result)) {
        throw new Error("invalid chat.prompt result");
      }
      return result;
    },
    async draftChat(description: string): Promise<ChatDraftResult> {
      await ready;
      const result = await call("chat.draft", { description });
      if (!isChatDraftResult(result)) {
        throw new Error("invalid chat.draft result");
      }
      return result;
    },
    async getChatSuggestions(): Promise<ChatSuggestionsResult> {
      await ready;
      const result = await call("chat.suggestions", {});
      if (!isChatSuggestionsResult(result)) {
        throw new Error("invalid chat.suggestions result");
      }
      return result;
    },
    async dismissChatSuggestion(line: string): Promise<ChatSuggestionDismissResult> {
      await ready;
      const result = await call("chat.suggestion_dismiss", { line });
      if (!isChatSuggestionDismissResult(result)) {
        throw new Error("invalid chat.suggestion_dismiss result");
      }
      return result;
    },
    async getNotifications(): Promise<NotificationsValues> {
      await ready;
      const result = await call("notifications.get", {});
      if (!isNotificationsValues(result)) {
        throw new Error("invalid notifications.get result");
      }
      return result;
    },
    async setNotifications(params: NotificationsSetParams): Promise<NotificationsSetResult> {
      await ready;
      const result = await call("notifications.set", { ...params });
      if (!isNotificationsSetResult(result)) {
        throw new Error("invalid notifications.set result");
      }
      return result;
    },
    async notifyTest(): Promise<NotifyTestResult> {
      await ready;
      const result = await call("notify.test", {});
      if (!isNotifyTestResult(result)) {
        throw new Error("invalid notify.test result");
      }
      return result;
    },
    async getRouting(): Promise<RoutingGetResult> {
      await ready;
      const result = await call("routing.get", {});
      if (!isRoutingGetResult(result)) {
        throw new Error("invalid routing.get result");
      }
      return result;
    },
    async setRouting(params: RoutingSetParams): Promise<RoutingSetResult> {
      await ready;
      const result = await call("routing.set", { ...params });
      if (!isRoutingSetResult(result)) {
        throw new Error("invalid routing.set result");
      }
      return result;
    },
    async getTrace(sessionId: string): Promise<TraceGetResult> {
      await ready;
      const result = await call("trace.get", { session_id: sessionId });
      if (!isTraceGetResult(result)) {
        throw new Error("invalid trace.get result");
      }
      return result;
    },
    async getTraceSpan(sessionId: string, spanId: string): Promise<TraceSpanResult> {
      await ready;
      const result = await call("trace.span", { session_id: sessionId, span_id: spanId });
      if (!isTraceSpanResult(result)) {
        throw new Error("invalid trace.span result");
      }
      return result;
    },
    async setKey(provider: string, key: string, options: { check?: boolean } = {}): Promise<AuthSetResult> {
      await ready;
      const params = options.check === false ? { provider, key, check: false } : { provider, key };
      const result = await call("auth.set", params);
      if (!isAuthSetResult(result)) {
        throw new Error("invalid auth.set result");
      }
      return result;
    },
    async removeKey(provider: string): Promise<AuthRemoveResult> {
      await ready;
      const result = await call("auth.remove", { provider });
      if (!isAuthRemoveResult(result)) {
        throw new Error("invalid auth.remove result");
      }
      return result;
    },
    async updateRule(
      target: "user" | "project",
      index: number,
      action: "allow" | "ask" | "deny",
      cwd?: string,
    ): Promise<PolicyEditResult> {
      await ready;
      return policyEdit(await call("policy.update", { target, index, action, ...(cwd === undefined ? {} : { cwd }) }));
    },
    async removeRule(target: "user" | "project", index: number, cwd?: string): Promise<PolicyEditResult> {
      await ready;
      return policyEdit(await call("policy.remove", { target, index, ...(cwd === undefined ? {} : { cwd }) }));
    },
    async revokeAllowance(sessionId: string, tool: string, subject: string | null): Promise<boolean> {
      await ready;
      const result = await call("session.revoke", { session_id: sessionId, tool, subject });
      if (!isRecord(result) || typeof result["revoked"] !== "boolean") {
        throw new Error("invalid session.revoke result");
      }
      return result["revoked"];
    },
    async readArtifact(sessionId: string, artifactId: string, offset = 0, limit = 5_000_000): Promise<ArtifactReadResult> {
      await ready;
      const result = await call("artifact.read", { session_id: sessionId, artifact_id: artifactId, offset, limit });
      if (
        !isRecord(result) ||
        typeof result["text"] !== "string" ||
        typeof result["offset"] !== "number" ||
        typeof result["size"] !== "number"
      ) {
        throw new Error("invalid artifact.read result");
      }
      return { text: result["text"], offset: result["offset"], size: result["size"] };
    },
    async changesList(sessionId: string): Promise<ChangesListResult> {
      await ready;
      const result = await call("changes.list", { session_id: sessionId });
      if (!isChangesListResult(result)) {
        throw new Error("invalid changes.list result");
      }
      return result;
    },
    async changesDiff(sessionId: string, target: ChangesDiffTarget): Promise<ChangesDiffResult> {
      await ready;
      const result = await call("changes.diff", {
        session_id: sessionId,
        ...("path" in target ? { path: target.path } : { change_id: target.changeId }),
      });
      if (!isRecord(result) || typeof result["diff"] !== "string" || typeof result["truncated"] !== "boolean") {
        throw new Error("invalid changes.diff result");
      }
      return { diff: result["diff"], truncated: result["truncated"] };
    },
    async changesRevert(sessionId: string, target: ChangesRevertTarget, force = false): Promise<ChangesRevertResult> {
      await ready;
      const wire =
        target.kind === "change"
          ? { kind: "change", change_id: target.changeId }
          : target.kind === "file"
            ? { kind: "file", path: target.path }
            : target.kind === "hunk"
              ? { kind: "hunk", path: target.path, hunk: target.hunk }
              : { kind: "run", run_id: target.runId };
      const result = await call("changes.revert", { session_id: sessionId, target: wire, force });
      if (!isChangesRevertResult(result)) {
        throw new Error("invalid changes.revert result");
      }
      return result;
    },
    async readFile(sessionId: string, path: string): Promise<FileReadResult> {
      await ready;
      const result = await call("file.read", { session_id: sessionId, path });
      if (!isFileReadResult(result)) {
        throw new Error("invalid file.read result");
      }
      return result;
    },
    async listFiles(sessionId: string, query?: string, limit?: number, hidden?: boolean): Promise<FileListResult> {
      await ready;
      const result = await call("file.list", {
        session_id: sessionId,
        ...(query === undefined ? {} : { query }),
        ...(limit === undefined ? {} : { limit }),
        ...(hidden === undefined ? {} : { hidden }),
      });
      if (!isFileListResult(result)) {
        throw new Error("invalid file.list result");
      }
      return result;
    },
    async changesCommit(sessionId: string, paths: string[], message: string): Promise<ChangesCommitResult> {
      await ready;
      const result = await call("changes.commit", { session_id: sessionId, paths, message });
      if (!isChangesCommitResult(result)) {
        throw new Error("invalid changes.commit result");
      }
      return result;
    },
    async changesCommitInfo(sessionId: string): Promise<ChangesCommitInfoResult> {
      await ready;
      const result = await call("changes.commit_info", { session_id: sessionId });
      if (!isChangesCommitInfoResult(result)) {
        throw new Error("invalid changes.commit_info result");
      }
      return result;
    },
    async changesSuggestMessage(sessionId: string, paths: string[]): Promise<ChangesSuggestMessageResult> {
      await ready;
      const result = await call("changes.suggest_message", { session_id: sessionId, paths });
      if (!isRecord(result) || typeof result["message"] !== "string") {
        throw new Error("invalid changes.suggest_message result");
      }
      return { message: result["message"] };
    },
    async respondApproval(
      sessionId: string,
      callId: string,
      decision: ApprovalChoice,
      args?: Readonly<Record<string, unknown>>,
      scope?: "batch",
    ): Promise<ApprovalRespondResult> {
      await ready;
      const params = {
        session_id: sessionId,
        call_id: callId,
        decision,
        ...(args === undefined ? {} : { args }),
        ...(scope === undefined ? {} : { scope }),
      };
      const result = await call("approval.respond", params);
      if (!isRecord(result) || typeof result["run_id"] !== "string") {
        throw new Error("invalid approval.respond result");
      }
      return { run_id: result["run_id"] };
    },
    async answerConsent(sessionId: string, runId: string, answer: ConsentChoice): Promise<RouteConsentAnswerResult> {
      await ready;
      const result = await call("route.consent.answer", { session_id: sessionId, run_id: runId, answer });
      if (!isRecord(result) || typeof result["run_id"] !== "string") {
        throw new Error("invalid route.consent.answer result");
      }
      return { run_id: result["run_id"] };
    },
    async getConfig(cwd?: string, sessionId?: string): Promise<ConfigGetResult> {
      await ready;
      const result = await call("config.get", {
        ...(cwd === undefined ? {} : { cwd }),
        ...(sessionId === undefined ? {} : { session_id: sessionId }),
      });
      if (!isConfigGetResult(result)) {
        throw new Error("invalid config.get result");
      }
      return result;
    },
    async listKeys(): Promise<AuthListResult> {
      await ready;
      const result = await call("auth.list", {});
      if (!isAuthListResult(result)) {
        throw new Error("invalid auth.list result");
      }
      return result;
    },
    async listModels(refresh = false, showAll = false): Promise<ModelListResult> {
      await ready;
      const result = await call("model.list", {
        ...(refresh ? { refresh: true } : {}),
        ...(showAll ? { show_all: true } : {}),
      });
      if (!isModelListResult(result)) {
        throw new Error("invalid model.list result");
      }
      return result;
    },
    async setSessionModel(sessionId: string, model: string): Promise<SessionSetModelResult> {
      await ready;
      const result = await call("session.set_model", { session_id: sessionId, model });
      if (!isSessionSetModelResult(result)) {
        throw new Error("invalid session.set_model result");
      }
      return result;
    },
    async resetModelScore(ref: string): Promise<ModelScoreResetResult> {
      await ready;
      const result = await call("model.score_reset", { ref });
      if (!isModelScoreResetResult(result)) {
        throw new Error("invalid model.score_reset result");
      }
      return result;
    },
    async setDefaultModel(model: string): Promise<ModelSetDefaultResult> {
      await ready;
      const result = await call("model.set_default", { model });
      if (!isModelSetDefaultResult(result)) {
        throw new Error("invalid model.set_default result");
      }
      return result;
    },
    async getOllamaSettings(): Promise<OllamaSettingsValues> {
      await ready;
      const result = await call("ollama.settings.get", {});
      if (!isOllamaSettingsValues(result)) {
        throw new Error("invalid ollama.settings.get result");
      }
      return result;
    },
    async setOllamaSettings(params: OllamaSettingsSetParams): Promise<OllamaSettingsSetResult> {
      await ready;
      const result = await call("ollama.settings.set", { ...params });
      if (!isOllamaSettingsSetResult(result)) {
        throw new Error("invalid ollama.settings.set result");
      }
      return result;
    },
    async starModel(ref: string, starred: boolean): Promise<ModelStarResult> {
      await ready;
      const result = await call("model.star", { ref, starred });
      if (!isModelStarResult(result)) {
        throw new Error("invalid model.star result");
      }
      return result;
    },
    async setDefaultPermissionMode(mode: PermissionsSetModeParams["mode"]): Promise<PermissionsSetModeResult> {
      await ready;
      const result = await call("permissions.set_mode", { mode });
      if (!isPermissionsSetModeResult(result)) {
        throw new Error("invalid permissions.set_mode result");
      }
      return result;
    },
    async getModelOptions(model: string, sessionId?: string): Promise<ModelOptionsGetResult> {
      await ready;
      const result = await call("model.options.get", sessionId === undefined ? { model } : { model, session_id: sessionId });
      if (!isModelOptionsGetResult(result)) {
        throw new Error("invalid model.options.get result");
      }
      return result;
    },
    async setModelOptions(model: string, options: Record<string, number | string | null>): Promise<ModelOptionsSetResult> {
      await ready;
      const result = await call("model.options.set", { model, options });
      if (!isModelOptionsSetResult(result)) {
        throw new Error("invalid model.options.set result");
      }
      return result;
    },
    async setSessionOptions(
      sessionId: string,
      options: Record<string, number | string | null>,
    ): Promise<SessionSetOptionsResult> {
      await ready;
      const result = await call("session.set_options", { session_id: sessionId, options });
      if (!isSessionSetOptionsResult(result)) {
        throw new Error("invalid session.set_options result");
      }
      return result;
    },
    async setSessionMode(sessionId: string, mode: SessionSetModeParams["mode"]): Promise<SessionSetModeResult> {
      await ready;
      const result = await call("session.set_mode", { session_id: sessionId, mode });
      if (!isSessionSetModeResult(result)) {
        throw new Error("invalid session.set_mode result");
      }
      return result;
    },
    async setRoute(sessionId: string, mode: SessionSetRouteParams["mode"]): Promise<SessionSetRouteResult> {
      await ready;
      const result = await call("session.set_route", { session_id: sessionId, mode });
      if (!isSessionSetRouteResult(result)) {
        throw new Error("invalid session.set_route result");
      }
      return result;
    },
    async compactSession(sessionId: string, action: "clear" | "summarise" | "grow", focus?: string): Promise<SessionCompactResult> {
      await ready;
      const result = await call("session.compact", { session_id: sessionId, action, focus: focus ?? null });
      if (!isSessionCompactResult(result)) {
        throw new Error("invalid session.compact result");
      }
      return result;
    },
    async setChecks(sessionId: string, on: boolean): Promise<SessionSetChecksResult> {
      await ready;
      const result = await call("session.set_checks", { session_id: sessionId, on });
      if (!isSessionSetChecksResult(result)) {
        throw new Error("invalid session.set_checks result");
      }
      return result;
    },
    async setPlan(sessionId: string, on: boolean): Promise<SessionSetPlanResult> {
      await ready;
      const result = await call("session.set_plan", { session_id: sessionId, on });
      if (!isSessionSetPlanResult(result)) {
        throw new Error("invalid session.set_plan result");
      }
      return result;
    },
    onOptionsSaved(listener: (saved: ModelOptionsSaved) => void): () => void {
      optionsSavedListeners.add(listener);
      return () => {
        optionsSavedListeners.delete(listener);
      };
    },
    async probeModel(name: string): Promise<ModelProbeResult> {
      await ready;
      const result = await call("model.probe", { name });
      if (!isModelProbeResult(result)) {
        throw new Error("invalid model.probe result");
      }
      return result;
    },
    async pullModel(name: string): Promise<ModelPullResult> {
      await ready;
      const result = await call("model.pull", { name });
      if (!isRefResult(result, "started")) {
        throw new Error("invalid model.pull result");
      }
      return result as ModelPullResult;
    },
    async cancelPull(name: string): Promise<ModelPullCancelResult> {
      await ready;
      const result = await call("model.pull_cancel", { name });
      if (!isRefResult(result, "cancelled")) {
        throw new Error("invalid model.pull_cancel result");
      }
      return result as ModelPullCancelResult;
    },
    async cleanupPull(ref: string): Promise<ModelPullCleanupResult> {
      await ready;
      const result = await call("model.pull_cleanup", { ref });
      if (!isPullCleanupResult(result)) {
        throw new Error("invalid model.pull_cleanup result");
      }
      return result;
    },
    async searchHf(query: string, limit?: number): Promise<HfSearchResult> {
      await ready;
      const result = await call("hf.search", limit === undefined ? { query } : { query, limit });
      if (!isHfSearchResult(result)) {
        throw new Error("invalid hf.search result");
      }
      return result;
    },
    async hfFiles(repo: string): Promise<HfFilesResult> {
      await ready;
      const result = await call("hf.files", { repo });
      if (!isHfFilesResult(result)) {
        throw new Error("invalid hf.files result");
      }
      return result;
    },
    async ollamaLibrary(query: string): Promise<OllamaLibraryResult> {
      await ready;
      const result = await call("ollama.library", { query });
      if (!isOllamaLibraryResult(result)) {
        throw new Error("invalid ollama.library result");
      }
      return result;
    },
    async deleteModel(name: string): Promise<ModelDeleteResult> {
      await ready;
      const result = await call("model.delete", { name });
      if (!isRefResult(result, "deleted")) {
        throw new Error("invalid model.delete result");
      }
      return result as ModelDeleteResult;
    },
    onPull(listener: (update: PullUpdate) => void): () => void {
      pullListeners.add(listener);
      return () => {
        pullListeners.delete(listener);
      };
    },
    async checkModel(name: string): Promise<ModelCheckResult> {
      await ready;
      const result = await call("model.check", { name });
      if (!isRefResult(result, "started")) {
        throw new Error("invalid model.check result");
      }
      return result as ModelCheckResult;
    },
    onCheck(listener: (update: CheckUpdate) => void): () => void {
      checkListeners.add(listener);
      return () => {
        checkListeners.delete(listener);
      };
    },
    async benchModel(ref: string, engine?: string): Promise<ModelBenchResult> {
      await ready;
      const result = await call("model.bench", engine === undefined ? { ref } : { ref, engine });
      if (!isRefResult(result, "started")) {
        throw new Error("invalid model.bench result");
      }
      return result as ModelBenchResult;
    },
    onBench(listener: (update: BenchUpdate) => void): () => void {
      benchListeners.add(listener);
      return () => {
        benchListeners.delete(listener);
      };
    },
    async listMcp(sessionId?: string): Promise<McpListResult> {
      await ready;
      const result = await call("mcp.list", sessionId === undefined ? {} : { session_id: sessionId });
      if (!isMcpListResult(result)) {
        throw new Error("invalid mcp.list result");
      }
      return result;
    },
    async enableMcp(sessionId: string, name: string): Promise<McpToggleResult> {
      return toggleMcp("mcp.enable", sessionId, name);
    },
    async disableMcp(sessionId: string, name: string): Promise<McpToggleResult> {
      return toggleMcp("mcp.disable", sessionId, name);
    },
    async setSkills(
      sessionId: string,
      change: { pin?: string[]; unpin?: string[] },
    ): Promise<SessionSetSkillsResult> {
      await ready;
      const result = await call("session.set_skills", { session_id: sessionId, ...change });
      if (!isSessionSetSkillsResult(result)) {
        throw new Error("invalid session.set_skills result");
      }
      return result;
    },
    async mcpTools(name: string, sessionId?: string): Promise<McpToolsResult> {
      await ready;
      const result = await call("mcp.tools", withSession({ name }, sessionId));
      if (!isMcpToolsResult(result)) {
        throw new Error("invalid mcp.tools result");
      }
      return result;
    },
    async restartMcp(name: string, sessionId?: string): Promise<McpServer> {
      return mcpServerCall("mcp.restart", withSession({ name }, sessionId));
    },
    async mcpLogin(name: string, sessionId?: string): Promise<McpLoginResult> {
      await ready;
      const result = await call("mcp.login", withSession({ name }, sessionId));
      if (!isMcpLoginResult(result)) {
        throw new Error("invalid mcp.login result");
      }
      return result;
    },
    async mcpLogout(name: string, sessionId?: string): Promise<McpServer> {
      return mcpServerCall("mcp.logout", withSession({ name }, sessionId));
    },
    async setMcpEnabled(name: string, enabled: boolean | "on_demand", sessionId?: string): Promise<McpServer> {
      return mcpServerCall("mcp.set_enabled", withSession({ name, enabled }, sessionId));
    },
    async addMcpServer(params: McpAddParams): Promise<McpServer> {
      return mcpServerCall("mcp.add", { ...params });
    },
    async mcpCatalog(sessionId?: string): Promise<McpCatalogResult> {
      await ready;
      const params: McpCatalogParams = sessionId === undefined ? {} : { session_id: sessionId };
      const result = await call("mcp.catalog", { ...params });
      if (!isMcpCatalogResult(result)) {
        throw new Error("invalid mcp.catalog result");
      }
      return result;
    },
    async mcpTest(params, onProgress): Promise<McpTestResult> {
      await ready;
      const testId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const listener = (progress: McpTestProgress): void => {
        if (progress.test_id === testId) onProgress?.(progress);
      };
      testListeners.add(listener);
      try {
        const secrets = "secrets" in params && params.secrets !== undefined ? { secrets: params.secrets } : {};
        const body =
          "catalogId" in params
            ? {
                catalog_id: params.catalogId,
                ...(params.inputs === undefined ? {} : { inputs: params.inputs }),
                ...(params.name === undefined ? {} : { name: params.name }),
                ...secrets,
              }
            : "name" in params
              ? { name: params.name }
              : { config: params.config, ...secrets };
        const result = await call("mcp.test", withSession({ test_id: testId, ...body }, params.sessionId));
        if (!isMcpTestResult(result)) {
          throw new Error("invalid mcp.test result");
        }
        return result;
      } finally {
        testListeners.delete(listener);
      }
    },
    async mcpLogs(name: string, options?: { sessionId?: string; limit?: number }): Promise<McpLogsResult> {
      await ready;
      const params = withSession({ name, ...(options?.limit === undefined ? {} : { limit: options.limit }) }, options?.sessionId);
      const result = await call("mcp.logs", params);
      if (!isMcpLogsResult(result)) {
        throw new Error("invalid mcp.logs result");
      }
      return result;
    },
    async mcpCall(params): Promise<McpCallResult> {
      await ready;
      const body = { name: params.name, tool: params.tool, ...(params.arguments === undefined ? {} : { arguments: params.arguments }) };
      const result = await call("mcp.call", withSession(body, params.sessionId));
      if (!isMcpCallResult(result)) {
        throw new Error("invalid mcp.call result");
      }
      return result;
    },
    onMcpLog(listener: (log: McpServerLog) => void): () => void {
      logListeners.add(listener);
      return () => {
        logListeners.delete(listener);
      };
    },
    async configRawGet(options?: { scope?: "user" | "project"; sessionId?: string }): Promise<ConfigRawGetResult> {
      await ready;
      const result = await call("config.raw.get", withSession({ scope: options?.scope ?? "user" }, options?.sessionId));
      if (!isConfigRawGetResult(result)) {
        throw new Error("invalid config.raw.get result");
      }
      return result;
    },
    async configRawSet(params, options): Promise<ConfigRawResult> {
      await ready;
      const body = withSession(
        {
          scope: params.scope ?? "user",
          text: params.text,
          base_mtime_ns: params.baseMtimeNs,
          ...(params.dryRun === true ? { dry_run: true } : {}),
        },
        params.sessionId,
      );
      const result = await call(options?.local === true ? "config.raw.set_protected" : "config.raw.set", body);
      if (!isConfigRawResult(result)) {
        throw new Error("invalid config.raw.set result");
      }
      return result;
    },
    async scanMcpImport(params?: { sessionId?: string; text?: string }): Promise<McpImportScanResult> {
      await ready;
      const body = withSession(params?.text === undefined ? {} : { text: params.text }, params?.sessionId);
      const result = await call("mcp.import.scan", body);
      if (!isMcpImportScanResult(result)) {
        throw new Error("invalid mcp.import.scan result");
      }
      return result;
    },
    async applyMcpImport(params: McpImportApplyParams): Promise<McpImportApplyResult> {
      await ready;
      const result = await call("mcp.import.apply", { ...params });
      if (!isMcpImportApplyResult(result)) {
        throw new Error("invalid mcp.import.apply result");
      }
      return result;
    },
    async updateMcpServer(params: McpUpdateParams): Promise<McpServer> {
      return mcpServerCall("mcp.update", { ...params });
    },
    async mcpGet(name: string, sessionId?: string): Promise<McpServerDetail> {
      await ready;
      const result = await call("mcp.get", withSession({ name }, sessionId));
      if (!isMcpServerDetail(result)) {
        throw new Error("invalid mcp.get result");
      }
      return result;
    },
    async installRuntime(name: RuntimeName): Promise<RuntimeInstallResult> {
      await ready;
      const result = await call("runtime.install", { name });
      if (!isRecord(result) || typeof result["started"] !== "boolean") {
        throw new Error("invalid runtime.install result");
      }
      return { name, started: result["started"] };
    },
    async cancelRuntimeInstall(name: RuntimeName): Promise<RuntimeInstallCancelResult> {
      await ready;
      const result = await call("runtime.install_cancel", { name });
      if (!isRecord(result) || typeof result["cancelled"] !== "boolean") {
        throw new Error("invalid runtime.install_cancel result");
      }
      return { name, cancelled: result["cancelled"] };
    },
    onRuntimeInstall(listener: (update: RuntimeInstallUpdate) => void): () => void {
      runtimeListeners.add(listener);
      return () => {
        runtimeListeners.delete(listener);
      };
    },
    async removeMcpServer(name: string): Promise<McpRemoveResult> {
      await ready;
      const result = await call("mcp.remove", { name });
      if (!isMcpRemoveResult(result)) {
        throw new Error("invalid mcp.remove result");
      }
      return result;
    },
    onMcpStatus(listener: (server: McpServer) => void): () => void {
      mcpListeners.add(listener);
      return () => {
        mcpListeners.delete(listener);
      };
    },
    onMcpLoginDone(listener: (done: McpLoginDone) => void): () => void {
      loginListeners.add(listener);
      return () => {
        loginListeners.delete(listener);
      };
    },
    onModelServer(listener: (status: ModelServerStatus) => void): () => void {
      serverListeners.add(listener);
      return () => {
        serverListeners.delete(listener);
      };
    },
    async listDirs(path?: string): Promise<FsListDirsResult> {
      await ready;
      const result = await call("fs.list_dirs", path === undefined ? {} : { path });
      if (!isFsListDirsResult(result)) {
        throw new Error("invalid fs.list_dirs result");
      }
      return result;
    },
    async gitInfo(path: string): Promise<GitInfoResult> {
      await ready;
      const result = await call("git.info", { path });
      if (!isGitInfoResult(result)) {
        throw new Error("invalid git.info result");
      }
      return result;
    },
    async gitBranches(path: string): Promise<GitBranchesResult> {
      await ready;
      const result = await call("git.branches", { path });
      if (!isGitBranchesResult(result)) {
        throw new Error("invalid git.branches result");
      }
      return result;
    },
    async chooseFolder(start?: string | null): Promise<FsChooseFolderResult> {
      await ready;
      const result = await call("fs.choose_folder", start === undefined || start === null ? {} : { start });
      if (!isFsChooseFolderResult(result)) {
        throw new Error("invalid fs.choose_folder result");
      }
      return result;
    },
    async reveal(path: string): Promise<FsRevealResult> {
      await ready;
      const result = await call("fs.reveal", { path });
      if (!isFsRevealResult(result)) {
        throw new Error("invalid fs.reveal result");
      }
      return result;
    },
    async setupStatus(): Promise<SetupStatusResult> {
      await ready;
      const result = await call("setup.status", {});
      if (!isSetupStatusResult(result)) {
        throw new Error("invalid setup.status result");
      }
      return result;
    },
    async installOllama(): Promise<OllamaInstallResult> {
      await ready;
      const result = await call("ollama.install", {});
      if (!isRecord(result) || typeof result["started"] !== "boolean") {
        throw new Error("invalid ollama.install result");
      }
      return { started: result["started"] };
    },
    async cancelOllamaInstall(): Promise<OllamaInstallCancelResult> {
      await ready;
      const result = await call("ollama.install_cancel", {});
      if (!isRecord(result) || typeof result["cancelled"] !== "boolean") {
        throw new Error("invalid ollama.install_cancel result");
      }
      return { cancelled: result["cancelled"] };
    },
    async startOllama(): Promise<OllamaStartResult> {
      await ready;
      const result = await call("ollama.start", {});
      if (!isRecord(result) || typeof result["running"] !== "boolean") {
        throw new Error("invalid ollama.start result");
      }
      return { running: result["running"] };
    },
    onOllamaInstall(listener: (update: OllamaInstallUpdate) => void): () => void {
      installListeners.add(listener);
      return () => {
        installListeners.delete(listener);
      };
    },
    onKeychainWait(listener: (wait: KeychainWait) => void): () => void {
      keychainListeners.add(listener);
      return () => {
        keychainListeners.delete(listener);
      };
    },
    async listSkills(cwd?: string): Promise<SkillListResult> {
      await ready;
      const result = await call("skill.list", cwd === undefined ? {} : { cwd });
      if (!isSkillListResult(result)) {
        throw new Error("invalid skill.list result");
      }
      return result;
    },
    async readSkill(name: string, cwd?: string): Promise<SkillReadResult> {
      await ready;
      const result = await call("skill.read", cwd === undefined ? { name } : { name, cwd });
      if (!isSkillReadResult(result)) {
        throw new Error("invalid skill.read result");
      }
      return result;
    },
    async writeSkill(params, options): Promise<SkillWriteResult> {
      await ready;
      const body = {
        path: params.path,
        text: params.text,
        base_mtime_ns: params.baseMtimeNs,
        ...(params.cwd === undefined ? {} : { cwd: params.cwd }),
        ...(params.dryRun === true ? { dry_run: true } : {}),
      };
      const result = await call(options?.local === true ? "skill.write_protected" : "skill.write", body);
      if (!isSkillWriteResult(result)) {
        throw new Error("invalid skill.write result");
      }
      return result;
    },
    async createSkill(params, options): Promise<SkillCreateResult> {
      await ready;
      const body = {
        name: params.name,
        scope: params.scope,
        description: params.description,
        ...(params.cwd === undefined ? {} : { cwd: params.cwd }),
        ...(params.modelInvocable === undefined ? {} : { model_invocable: params.modelInvocable }),
      };
      const result = await call(options?.local === true ? "skill.create_protected" : "skill.create", body);
      if (!isSkillCreateResult(result)) {
        throw new Error("invalid skill.create result");
      }
      return result;
    },
    async listRoutines(folders?: string[]): Promise<RoutineListResult> {
      await ready;
      const result = await call("routine.list", folders === undefined ? {} : { folders });
      if (!isRoutineListResult(result)) {
        throw new Error("invalid routine.list result");
      }
      return result;
    },
    async listRuns(options?: { limit?: number; sessionId?: string }): Promise<RunListResult> {
      await ready;
      const params: Record<string, unknown> = {};
      if (options?.limit !== undefined) params["limit"] = options.limit;
      if (options?.sessionId !== undefined) params["session_id"] = options.sessionId;
      const result = await call("run.list", params);
      if (!isRunListResult(result)) {
        throw new Error("invalid run.list result");
      }
      return result;
    },
    async getRoutine(name: string, folder?: string): Promise<RoutineGetResult> {
      await ready;
      const result = await call("routine.get", folder === undefined ? { name } : { name, folder });
      if (!isRoutineGetResult(result)) {
        throw new Error("invalid routine.get result");
      }
      return result;
    },
    async runRoutine(name: string, folder?: string): Promise<RoutineRunResult> {
      await ready;
      const result = await call("routine.run", folder === undefined ? { name } : { name, folder });
      if (!isRoutineRunResult(result)) {
        throw new Error("invalid routine.run result");
      }
      return result;
    },
    async updateRoutine(name: string, fields: Record<string, unknown>, options?: { create?: boolean }): Promise<RoutineUpdateResult> {
      await ready;
      const result = await call("routine.update", options?.create === true ? { name, fields, create: true } : { name, fields });
      if (!isRoutineUpdateResult(result)) {
        throw new Error("invalid routine.update result");
      }
      return result;
    },
    async previewRoutine(schedule: string): Promise<RoutinePreviewResult> {
      await ready;
      const result = await call("routine.preview", { schedule });
      if (!isRoutinePreviewResult(result)) {
        throw new Error("invalid routine.preview result");
      }
      return result;
    },
    async setSkillDisabled(name: string, disabled: boolean): Promise<SkillSetDisabledResult> {
      await ready;
      const result = await call("skill.set_disabled", { name, disabled });
      if (!isSkillSetDisabledResult(result)) {
        throw new Error("invalid skill.set_disabled result");
      }
      return result;
    },
    onSkillsChanged(listener: (root: string | null) => void): () => void {
      skillListeners.add(listener);
      return () => {
        skillListeners.delete(listener);
      };
    },
    async listAgents(cwd?: string): Promise<AgentsListResult> {
      await ready;
      const result = await call("agents.list", cwd === undefined ? {} : { cwd });
      if (!isAgentsListResult(result)) {
        throw new Error("invalid agents.list result");
      }
      return result;
    },
    async setAgentWish(name: string, wish: string, cwd?: string): Promise<AgentsSetWishResult> {
      await ready;
      const result = await call("agents.set_wish", cwd === undefined ? { name, wish } : { name, wish, cwd });
      if (!isAgentsSetWishResult(result)) {
        throw new Error("invalid agents.set_wish result");
      }
      return result;
    },
    async agentsKeep(change?: { keep_days?: number; keep_problem_days?: number; use_helpers?: "when_needed" | "ask" | "never" }): Promise<AgentsKeepResult> {
      await ready;
      const result = await call("agents.keep", { ...change });
      if (!isAgentsKeepResult(result)) {
        throw new Error("invalid agents.keep result");
      }
      return result;
    },
    async setAgentLimits(name: string, change: AgentLimitsChange, cwd?: string): Promise<AgentsSetLimitsResult> {
      await ready;
      const result = await call("agents.set_limits", cwd === undefined ? { name, ...change } : { name, ...change, cwd });
      if (!isAgentsSetLimitsResult(result)) {
        throw new Error("invalid agents.set_limits result");
      }
      return result;
    },
    async setDefaultAgentLimits(change: AgentLimitsChange): Promise<AgentsKeepResult> {
      await ready;
      const result = await call("agents.set_default_limits", { ...change });
      if (!isAgentsKeepResult(result)) {
        throw new Error("invalid agents.set_default_limits result");
      }
      return result;
    },
    async evalsPlan(arms?: string[], models?: Record<string, string>): Promise<EvalsPlanResult> {
      await ready;
      const result = await call("evals.plan", {
        ...(arms === undefined ? {} : { arms }),
        ...(models === undefined ? {} : { models }),
      });
      if (!isEvalsPlanResult(result)) {
        throw new Error("invalid evals.plan result");
      }
      return result;
    },
    async evalsStart(params: EvalsStartParams): Promise<EvalsStartResult> {
      await ready;
      const result = await call("evals.start", { ...params });
      if (!isEvalsStartResult(result)) {
        throw new Error("invalid evals.start result");
      }
      return result;
    },
    async evalsStop(id: string): Promise<EvalsStopResult> {
      await ready;
      const result = await call("evals.stop", { id });
      if (!isEvalsStopResult(result)) {
        throw new Error("invalid evals.stop result");
      }
      return result;
    },
    async evalsResume(id: string, allowTight?: boolean, ownRisk?: boolean): Promise<EvalsResumeResult> {
      await ready;
      const result = await call("evals.resume", {
        id,
        ...(allowTight === undefined ? {} : { allow_tight: allowTight }),
        ...(ownRisk === undefined ? {} : { own_risk: ownRisk }),
      });
      if (!isEvalsResumeResult(result)) {
        throw new Error("invalid evals.resume result");
      }
      return result;
    },
    async evalsList(): Promise<EvalsListResult> {
      await ready;
      const result = await call("evals.list", {});
      if (!isEvalsListResult(result)) {
        throw new Error("invalid evals.list result");
      }
      return result;
    },
    async evalsGet(id: string): Promise<EvalsGetResult> {
      await ready;
      const result = await call("evals.get", { id });
      if (!isEvalsGetResult(result)) {
        throw new Error("invalid evals.get result");
      }
      return result;
    },
    async evalsApply(id: string): Promise<EvalsApplyResult> {
      await ready;
      const result = await call("evals.apply", { id });
      if (!isEvalsApplyResult(result)) {
        throw new Error("invalid evals.apply result");
      }
      return result;
    },
    async evalsDelete(id: string): Promise<EvalsDeleteResult> {
      await ready;
      const result = await call("evals.delete", { id });
      if (!isEvalsDeleteResult(result)) {
        throw new Error("invalid evals.delete result");
      }
      return result;
    },
    onEval(listener: (update: EvalUpdate) => void): () => void {
      evalListeners.add(listener);
      return () => {
        evalListeners.delete(listener);
      };
    },
    async saveAgent(text: string, name?: string, cwd?: string): Promise<AgentsSaveResult> {
      await ready;
      const result = await call("agents.save", {
        text,
        ...(name === undefined ? {} : { name }),
        ...(cwd === undefined ? {} : { cwd }),
      });
      if (!isAgentsSaveResult(result)) {
        throw new Error("invalid agents.save result");
      }
      return result;
    },
    async copyAgent(name: string, cwd?: string): Promise<AgentsCopyResult> {
      await ready;
      const result = await call("agents.copy", cwd === undefined ? { name } : { name, cwd });
      if (!isAgentsCopyResult(result)) {
        throw new Error("invalid agents.copy result");
      }
      return result;
    },
    async deleteAgent(name: string, cwd?: string): Promise<AgentsDeleteResult> {
      await ready;
      const result = await call("agents.delete", cwd === undefined ? { name } : { name, cwd });
      if (!isAgentsDeleteResult(result)) {
        throw new Error("invalid agents.delete result");
      }
      return result;
    },
    onAgentsChanged(listener: (root: string | null) => void): () => void {
      agentListeners.add(listener);
      return () => {
        agentListeners.delete(listener);
      };
    },
    async removeRoutine(name: string): Promise<RoutineRemoveResult> {
      await ready;
      const result = await call("routine.remove", { name });
      if (!isRoutineRemoveResult(result)) {
        throw new Error("invalid routine.remove result");
      }
      return result;
    },
    onRoutinesChanged(listener: (kind: "changed" | "fired" | "finished") => void): () => void {
      routineListeners.add(listener);
      return () => {
        routineListeners.delete(listener);
      };
    },
    async listMemories(params?: MemoryListParams): Promise<MemoryListResult> {
      await ready;
      const result = await call("memory.list", { ...params });
      if (!isMemoryListResult(result)) {
        throw new Error("invalid memory.list result");
      }
      return result;
    },
    async getMemory(id: string): Promise<MemoryGetResult> {
      await ready;
      const result = await call("memory.get", { id });
      if (!isMemoryGetResult(result)) {
        throw new Error("invalid memory.get result");
      }
      return result;
    },
    async writeMemory(params: MemoryWriteParams): Promise<MemoryWriteResult> {
      await ready;
      const result = await call("memory.write", { ...params });
      if (!isMemoryWriteResult(result)) {
        throw new Error("invalid memory.write result");
      }
      return result;
    },
    async updateMemory(params: MemoryUpdateParams): Promise<MemoryUpdateResult> {
      await ready;
      const result = await call("memory.update", { ...params });
      if (!isMemoryUpdateResult(result)) {
        throw new Error("invalid memory.update result");
      }
      return result;
    },
    async deleteMemories(ids: string[]): Promise<MemoryDeleteResult> {
      await ready;
      const result = await call("memory.delete", { ids });
      if (!isMemoryDeleteResult(result)) {
        throw new Error("invalid memory.delete result");
      }
      return result;
    },
    async exportMemories(params: MemoryExportParams): Promise<MemoryExportResult> {
      await ready;
      const result = await call("memory.export", { ...params });
      if (!isMemoryExportResult(result)) {
        throw new Error("invalid memory.export result");
      }
      return result;
    },
    async memorySettings(change?: { scope: "you" | "project" | "history"; privacy: "chat" | "local" }): Promise<MemorySettingsResult> {
      await ready;
      const result = await call("memory.settings", change ?? {});
      if (!isMemorySettingsResult(result)) {
        throw new Error("invalid memory.settings result");
      }
      return result;
    },
    async deviceList(): Promise<DeviceListResult> {
      await ready;
      const result = await call("device.list", {});
      if (!isDeviceListResult(result)) throw new Error("invalid device.list result");
      return result;
    },
    async devicePairBegin(): Promise<DevicePairBeginResult> {
      await ready;
      const result = await call("device.pair.begin", {});
      if (!isDevicePairBeginResult(result)) throw new Error("invalid device.pair.begin result");
      return result;
    },
    async devicePairConfirm(pair: string, accept = true): Promise<DevicePairConfirmResult> {
      await ready;
      const result = await call("device.pair.confirm", { pair, accept });
      if (!isDevicePairConfirmResult(result)) throw new Error("invalid device.pair.confirm result");
      return result;
    },
    async deviceRename(device: string, name: string): Promise<DeviceRenameResult> {
      await ready;
      const result = await call("device.rename", { device, name });
      if (!isDeviceRenameResult(result)) throw new Error("invalid device.rename result");
      return result;
    },
    async deviceRevoke(device: string): Promise<DeviceRevokeResult> {
      await ready;
      const result = await call("device.revoke", { device });
      if (!isDeviceRevokeResult(result)) throw new Error("invalid device.revoke result");
      return result;
    },
    onDevicePairChanged(listener: (change: DevicePairChanged) => void): () => void {
      pairListeners.add(listener);
      return () => {
        pairListeners.delete(listener);
      };
    },
    onDevicesChanged(listener: () => void): () => void {
      deviceListeners.add(listener);
      return () => {
        deviceListeners.delete(listener);
      };
    },
    onMemoryChanged(listener: (change: MemoryChanged) => void): () => void {
      memoryListeners.add(listener);
      return () => {
        memoryListeners.delete(listener);
      };
    },
    close(): void {
      if (userClosed) {
        return;
      }
      userClosed = true;
      generation += 1;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
      }
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
      }
      stopHeartbeat();
      link?.close();
      rejectPending(new Error("closed"));
      failReady(new Error("closed"));
      setState({ status: "closed", reason: "closed" });
    },
  };
}
