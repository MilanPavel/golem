import { randomUUID } from "node:crypto";
import net from "node:net";

import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";
import type { MessageSendResult } from "../../protocol/gen/message-send-result.ts";
import type { Params as ChatEvent } from "../../protocol/gen/rpc-notification.ts";
import type { RunCancelResult } from "../../protocol/gen/run-cancel-result.ts";
import type { SessionAttachResult } from "../../protocol/gen/session-attach-result.ts";
import type { SessionCreateResult } from "../../protocol/gen/session-create-result.ts";
import type { SessionInspectResult } from "../../protocol/gen/session-inspect-result.ts";
import type { SessionListResult, SessionSummary } from "../../protocol/gen/session-list-result.ts";
import { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "../../protocol/gen/version.ts";
import { Attachments } from "./attachments.ts";
import { backoffDelayMs } from "./backoff.ts";
import {
  asChatEvent,
  isDaemonStatus,
  isHelloResult,
  isMessageSendResult,
  isPing,
  isRecord,
  isRunCancelResult,
  isSessionAttachResult,
  isSessionCreateResult,
  isSessionInspectResult,
  isSessionListResult,
  isSessionSummary,
} from "./guards.ts";
import { pushWire, type WireFrame, type WireLine } from "./wire.ts";
import { eventFrame, flat, outgoingDetail, resultDetail, summaryFrame } from "./wire-detail.ts";

const PROTOCOL_MISMATCH = -32001;
export const SESSION_NOT_FOUND = -32003;
export const SESSION_BUSY = -32004;
export const MODEL_NOT_CONFIGURED = -32005;
export const RUN_NOT_FOUND = -32006;

export type { ChatEvent, SessionSummary };
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
  | { status: "reconnecting"; attempt: number; delayMs: number }
  | { status: "closed"; reason: string }
  | { status: "rejected"; reason: string };

export interface ConnectOptions {
  socketPath: string;
  clientName: string;
  reconnect: boolean;
  heartbeatMs?: number;
  heartbeatTimeoutMs?: number;
  connectTimeoutMs?: number;
  backoff?: (attempt: number) => number;
}

export interface GolemClient {
  readonly state: ConnectionState;
  readonly ready: Promise<void>;
  onState(listener: (state: ConnectionState) => void): () => void;
  onEvent(listener: (event: ChatEvent) => void): () => void;
  /** Summaries from {@link GolemClient.watchSessions}: the list itself, then each change. */
  onSessionSummary(listener: (summary: SessionSummary) => void): () => void;
  onWire(listener: (lines: readonly WireLine[]) => void): () => void;
  status(): Promise<DaemonStatus>;
  /** Create a session. Its events arrive only after {@link GolemClient.attachSession}. */
  createSession(): Promise<SessionCreateResult>;
  /**
   * Replay the session's events after `afterSeq`, then stream new ones.
   * The client attaches again after a reconnect, from the last `seq` it saw.
   */
  attachSession(sessionId: string, afterSeq?: number): Promise<SessionAttachResult>;
  detachSession(sessionId: string): Promise<void>;
  listSessions(limit?: number): Promise<SessionListResult>;
  /**
   * Follow the session list. Every listed session, then every later change,
   * reaches {@link GolemClient.onSessionSummary}. After a reconnect the client
   * lists and watches again by itself. Merge with `mergeSummary`.
   */
  watchSessions(limit?: number): Promise<void>;
  sendMessage(sessionId: string, text: string): Promise<MessageSendResult>;
  /** Stop a run. Resolves after `run.cancelled` is in the log; `cancelled` is false when it had ended. */
  cancelRun(runId: string): Promise<RunCancelResult>;
  inspectSession(sessionId: string): Promise<SessionInspectResult>;
  close(): void;
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function connectGolem(options: ConnectOptions): GolemClient {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const backoff = options.backoff ?? backoffDelayMs;

  let state: ConnectionState = { status: "connecting" };
  const listeners = new Set<(next: ConnectionState) => void>();
  const eventListeners = new Set<(event: ChatEvent) => void>();
  const summaryListeners = new Set<(summary: SessionSummary) => void>();
  const wireListeners = new Set<(lines: readonly WireLine[]) => void>();
  const pending = new Map<number, Pending>();
  const attachments = new Attachments();
  let watching = false;
  let watchLimit: number | undefined;
  let wire: WireLine[] = [];
  let nextId = 1;
  let generation = 0;
  let attempt = 0;
  let socket: net.Socket | undefined;
  let userClosed = false;
  let rejected = false;
  let readySettled = false;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let connectTimer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;

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

  function call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const current = socket;
    if (current === undefined || current.destroyed) {
      return Promise.reject(new Error("not connected"));
    }
    const id = nextId;
    nextId += 1;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params, id });
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      record({
        direction: "out",
        kind: method === "ping" ? "ping" : method,
        detail: outgoingDetail(method, params),
        json: method === "ping" ? "" : payload,
      });
      current.write(`${payload}\n`);
    });
  }

  function handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      record({ direction: "in", kind: "invalid json" });
      socket?.destroy(new Error("invalid json"));
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
        socket?.destroy();
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

  function onSocketClosed(error: Error | undefined): void {
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
    setState({ status: "reconnecting", attempt, delayMs });
    reconnectTimer = setTimeout(() => {
      openSocket();
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

  function startHeartbeat(current: net.Socket, gen: number): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (gen !== generation || current.destroyed) {
        return;
      }
      const nonce = randomUUID();
      const timeout = setTimeout(() => {
        current.destroy(new Error("heartbeat timeout"));
      }, heartbeatTimeoutMs);
      void call("ping", { nonce })
        .then((result) => {
          clearTimeout(timeout);
          if (!isPing(result) || result.nonce !== nonce) {
            current.destroy(new Error("heartbeat nonce mismatch"));
          }
        })
        .catch(() => {
          clearTimeout(timeout);
        });
    }, heartbeatMs);
  }

  function openSocket(): void {
    const gen = ++generation;
    const current = net.createConnection(options.socketPath);
    socket = current;
    let buffer = "";
    let lastError: Error | undefined;
    connectTimer = setTimeout(() => {
      current.destroy(new Error("timed out"));
    }, connectTimeoutMs);

    current.on("error", (error: Error) => {
      lastError = error;
    });
    current.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          handleLine(line);
        }
        newline = buffer.indexOf("\n");
      }
    });
    current.on("close", () => {
      if (gen !== generation) {
        return;
      }
      onSocketClosed(lastError);
    });
    current.on("connect", () => {
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
            current.destroy();
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
            current.destroy();
          }
        });
    });
  }

  openSocket();

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
    async createSession(): Promise<SessionCreateResult> {
      await ready;
      const result = await call("session.create", {});
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
    async listSessions(limit?: number): Promise<SessionListResult> {
      await ready;
      const result = await call("session.list", limit === undefined ? {} : { limit });
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
    async sendMessage(sessionId: string, text: string): Promise<MessageSendResult> {
      await ready;
      const result = await call("message.send", { session_id: sessionId, text });
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
      socket?.destroy();
      rejectPending(new Error("closed"));
      failReady(new Error("closed"));
      setState({ status: "closed", reason: "closed" });
    },
  };
}
