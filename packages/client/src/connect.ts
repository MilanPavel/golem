import type { Dial, Link } from "./link.ts";

import type { AuthListResult } from "../../protocol/gen/auth-list-result.ts";
import type { AuthRemoveResult } from "../../protocol/gen/auth-remove-result.ts";
import type { AuthSetResult } from "../../protocol/gen/auth-set-result.ts";
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
  isDaemonStatus,
  isHelloResult,
  isMcpListResult,
  isMcpServer,
  isMcpToggleResult,
  isSessionSetSkillsResult,
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

  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
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
  createSession(options?: { cwd?: string }): Promise<SessionCreateResult>;
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
  /** Store a provider's API key in the daemon's credential store. The wire view shows it redacted. */
  setKey(provider: string, key: string): Promise<AuthSetResult>;
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
  listModels(refresh?: boolean): Promise<ModelListResult>;
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
  /** `mcp.server.status`: a server started, failed, or changed its tools. */
  onMcpStatus(listener: (server: McpServer) => void): () => void;
  /** `model.server.status`: a local model server such as Ollama started, failed, or stopped. */
  onModelServer(listener: (status: ModelServerStatus) => void): () => void;
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
  close(): void;
}

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
  const skillListeners = new Set<(root: string | null) => void>();
  const serverListeners = new Set<(status: ModelServerStatus) => void>();
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
      const error = new RpcError(code, text);
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

  function startHeartbeat(current: Link, gen: number): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
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
    async createSession(options?: { cwd?: string }): Promise<SessionCreateResult> {
      await ready;
      const result = await call("session.create", options?.cwd === undefined ? {} : { cwd: options.cwd });
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
      await ready;
      await call("session.detach", { session_id: sessionId });
      attachments.untrack(sessionId);
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
    async setKey(provider: string, key: string): Promise<AuthSetResult> {
      await ready;
      const result = await call("auth.set", { provider, key });
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
    async listModels(refresh = false): Promise<ModelListResult> {
      await ready;
      const result = await call("model.list", refresh ? { refresh: true } : {});
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
