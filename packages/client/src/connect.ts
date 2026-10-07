import { randomUUID } from "node:crypto";
import net from "node:net";

import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";
import type { HelloResult } from "../../protocol/gen/hello-result.ts";
import type { Ping } from "../../protocol/gen/ping.ts";
import { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "../../protocol/gen/version.ts";
import { backoffDelayMs } from "./backoff.ts";

const PROTOCOL_MISMATCH = -32001;
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
  status(): Promise<DaemonStatus>;
  close(): void;
}

interface Pending {
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
  const pending = new Map<number, Pending>();
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

  function call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const current = socket;
    if (current === undefined || current.destroyed) {
      return Promise.reject(new Error("not connected"));
    }
    const id = nextId;
    nextId += 1;
    const body = `${JSON.stringify({ jsonrpc: "2.0", method, params, id })}\n`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      current.write(body);
    });
  }

  function handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      socket?.destroy(new Error("invalid json"));
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
    waiter.resolve(message["result"]);
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
        .then((result) => {
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
          attempt = 0;
          setState({ status: "connected" });
          settleReady();
          startHeartbeat(current, gen);
        })
        .catch(() => {
          // The close handler reconnects, or records a protocol rejection.
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
    async status(): Promise<DaemonStatus> {
      await ready;
      const result = await call("daemon.status", {});
      if (!isDaemonStatus(result)) {
        throw new Error("invalid daemon.status result");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHelloResult(value: unknown): value is HelloResult {
  return isRecord(value) && typeof value["protocol_major"] === "number";
}

function isPing(value: unknown): value is Ping {
  return isRecord(value) && value["type"] === "system.ping" && typeof value["nonce"] === "string";
}

function isDaemonStatus(value: unknown): value is DaemonStatus {
  return (
    isRecord(value) &&
    typeof value["pid"] === "number" &&
    typeof value["version"] === "string" &&
    typeof value["protocol_major"] === "number" &&
    typeof value["protocol_minor"] === "number" &&
    typeof value["uptime_seconds"] === "number" &&
    (value["state"] === "running" || value["state"] === "draining")
  );
}
