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
import type { McpRemoveResult } from "../../protocol/gen/mcp-remove-result.ts";
import type { OllamaInstallCancelResult } from "../../protocol/gen/ollama-install-cancel-result.ts";
import type { KeychainWait } from "../../protocol/gen/keychain-wait.ts";
import type { OllamaInstallDone } from "../../protocol/gen/ollama-install-done.ts";
import type { OllamaInstallResult } from "../../protocol/gen/ollama-install-result.ts";
import type { OllamaStartResult } from "../../protocol/gen/ollama-start-result.ts";
import type { FsListDirsResult } from "../../protocol/gen/fs-list-dirs-result.ts";
import type { SetupStatusResult } from "../../protocol/gen/setup-status-result.ts";
import type { ApprovalRespondResult } from "../../protocol/gen/approval-respond-result.ts";
import type { ArtifactReadResult } from "../../protocol/gen/artifact-read-result.ts";
import type { ConfigGetResult } from "../../protocol/gen/config-get-result.ts";
import type { PolicyEditResult } from "../../protocol/gen/policy-edit-result.ts";

export type ApprovalChoice = "allow" | "allow_session" | "allow_always" | "deny";

/** `cwd` is the sender's folder. `skill` runs a skill once by name. */
export type SendOptions = { cwd?: string; skill?: SkillCall };
import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";
import type { McpListResult } from "../../protocol/gen/mcp-list-result.ts";
import type { McpServer } from "../../protocol/gen/mcp-server.ts";
import type { ModelServerStatus } from "../../protocol/gen/model-server-status.ts";
import type { SkillCall } from "../../protocol/gen/skill-call.ts";
import type { SkillListResult } from "../../protocol/gen/skill-list-result.ts";
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
import type { ModelDeleteResult } from "../../protocol/gen/model-delete-result.ts";
import type { ModelProbeResult } from "../../protocol/gen/model-probe-result.ts";
import type { ModelPullCancelResult } from "../../protocol/gen/model-pull-cancel-result.ts";
import type { ModelPullDone } from "../../protocol/gen/model-pull-done.ts";
import type { ModelPullProgress } from "../../protocol/gen/model-pull-progress.ts";
import type { ModelPullResult } from "../../protocol/gen/model-pull-result.ts";
import type { ModelSetDefaultResult } from "../../protocol/gen/model-set-default-result.ts";
import type { SessionSetModelResult } from "../../protocol/gen/session-set-model-result.ts";
import type { Params as ChatEvent } from "../../protocol/gen/rpc-notification.ts";
import type { RunCancelResult } from "../../protocol/gen/run-cancel-result.ts";
import type { SessionAttachResult } from "../../protocol/gen/session-attach-result.ts";
import type { SessionCloseResult } from "../../protocol/gen/session-close-result.ts";
import type { SessionCreateResult } from "../../protocol/gen/session-create-result.ts";
import type { SessionForkResult } from "../../protocol/gen/session-fork-result.ts";
import type { SessionInspectResult } from "../../protocol/gen/session-inspect-result.ts";
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
  isFsListDirsResult,
  isSetupStatusResult,
  isDaemonStatus,
  isHelloResult,
  isMcpListResult,
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
  isModelProbeResult,
  isModelServerStatus,
  isModelSetDefaultResult,
  isPullDone,
  isPullProgress,
  isRefResult,
  isSkillListResult,
  isSessionSetModelResult,
  isPing,
  isRecord,
  isRunCancelResult,
  isSessionAttachResult,
  isSessionCloseResult,
  isSessionCreateResult,
  isSessionForkResult,
  isSessionInspectResult,
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

export interface GolemClient {
  readonly state: ConnectionState;
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
   */
  createSession(options?: { cwd?: string; modelProfile?: string }): Promise<SessionCreateResult>;
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
  forkSession(sessionId: string, atMessageId: string): Promise<SessionForkResult>;
  /** Set the title by hand. Resolves with the title as stored: one line, at most 60 characters. */
  renameSession(sessionId: string, title: string): Promise<SessionRenameResult>;
  /** `cwd` gives a session without a project folder this one. A session with a folder keeps its own. */
  /** With `skill`, the daemon runs that skill once and `text` is the line as typed. */
  sendMessage(sessionId: string, text: string, options?: SendOptions): Promise<MessageSendResult>;
  /** Stop a run. Resolves after `run.cancelled` is in the log; `cancelled` is false when it had ended. */
  cancelRun(runId: string): Promise<RunCancelResult>;
  inspectSession(sessionId: string): Promise<SessionInspectResult>;
  /** A session's runs as a tree: run, then model call, then tool call. Oldest run first. */
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
  /** `args` are the call's arguments as the user edited them. They go only with `allow`. */
  respondApproval(
    sessionId: string,
    callId: string,
    decision: ApprovalChoice,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<ApprovalRespondResult>;
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
  setDefaultModel(model: string): Promise<ModelSetDefaultResult>;
  /** Size, fit, and free disk for a local model before downloading it. */
  probeModel(name: string): Promise<ModelProbeResult>;
  /** Start downloading. Progress reaches {@link GolemClient.onPull} on every connection. */
  pullModel(name: string): Promise<ModelPullResult>;
  cancelPull(name: string): Promise<ModelPullCancelResult>;
  deleteModel(name: string): Promise<ModelDeleteResult>;
  /** `model.pull.progress` and `model.pull.done`, from any client's download. */
  onPull(listener: (update: PullUpdate) => void): () => void;
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
  /** `model.server.status`: a local model server such as Ollama started, failed, or stopped. */
  onModelServer(listener: (status: ModelServerStatus) => void): () => void;
  /**
   * The folders directly under `path`, for a folder picker. `path` is an absolute path under the
   * home folder; without one the home folder is listed. A path outside home is refused.
   */
  listDirs(path?: string): Promise<FsListDirsResult>;
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
  /**
   * `skill.registry.changed`: skills changed on disk. `root` is the folder
   * whose project skills changed, or `null` when every folder's did.
   */
  onSkillsChanged(listener: (root: string | null) => void): () => void;
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
  const listeners = new Set<(next: ConnectionState) => void>();
  const eventListeners = new Set<(event: ChatEvent) => void>();
  const summaryListeners = new Set<(summary: SessionSummary) => void>();
  const wireListeners = new Set<(lines: readonly WireLine[]) => void>();
  const pullListeners = new Set<(update: PullUpdate) => void>();
  const mcpListeners = new Set<(server: McpServer) => void>();
  const testListeners = new Set<(progress: McpTestProgress) => void>();
  const logListeners = new Set<(log: McpServerLog) => void>();
  const skillListeners = new Set<(root: string | null) => void>();
  const serverListeners = new Set<(status: ModelServerStatus) => void>();
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
    async createSession(options?: { cwd?: string; modelProfile?: string }): Promise<SessionCreateResult> {
      await ready;
      const params: { cwd?: string; model_profile?: string } = {};
      if (options?.cwd !== undefined) params.cwd = options.cwd;
      if (options?.modelProfile !== undefined) params.model_profile = options.modelProfile;
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
    async forkSession(sessionId: string, atMessageId: string): Promise<SessionForkResult> {
      await ready;
      const result = await call("session.fork", { session_id: sessionId, at_message_id: atMessageId });
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
    async inspectSession(sessionId: string): Promise<SessionInspectResult> {
      await ready;
      const result = await call("session.inspect", { session_id: sessionId });
      if (!isSessionInspectResult(result)) {
        throw new Error("invalid session.inspect result");
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
    async respondApproval(
      sessionId: string,
      callId: string,
      decision: ApprovalChoice,
      args?: Readonly<Record<string, unknown>>,
    ): Promise<ApprovalRespondResult> {
      await ready;
      const params = { session_id: sessionId, call_id: callId, decision, ...(args === undefined ? {} : { args }) };
      const result = await call("approval.respond", params);
      if (!isRecord(result) || typeof result["run_id"] !== "string") {
        throw new Error("invalid approval.respond result");
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
    async setDefaultModel(model: string): Promise<ModelSetDefaultResult> {
      await ready;
      const result = await call("model.set_default", { model });
      if (!isModelSetDefaultResult(result)) {
        throw new Error("invalid model.set_default result");
      }
      return result;
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
    onSkillsChanged(listener: (root: string | null) => void): () => void {
      skillListeners.add(listener);
      return () => {
        skillListeners.delete(listener);
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
