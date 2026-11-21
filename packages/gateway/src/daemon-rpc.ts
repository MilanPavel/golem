// The gateway as a client of the daemon's JSON lines, for the relay's own calls: `relay.sign`,
// `relay.dh`, `device.sync`, and the `device.changed` notification. It has no Node import: the
// adapter hands in `OpenDaemon`, which opens a Unix socket.

import { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "../../protocol/gen/version.ts";
import { createLineSplitter } from "./lines.ts";

/** What the gateway does to a daemon socket. */
export interface DaemonSocket {
  write(line: string): void;
  /** Bytes queued and not yet written. */
  backlog(): number;
  destroy(): void;
  pause(): void;
  resume(): void;
}

/** What a daemon socket tells the gateway. `error` is a connect or socket failure. */
export interface DaemonHandlers {
  open(): void;
  data(chunk: Uint8Array): void;
  close(): void;
  error(): void;
}

/** Open a connection to the daemon's socket. Events arrive on `handlers`. */
export type OpenDaemon = (handlers: DaemonHandlers) => DaemonSocket;

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export interface Rpc {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export interface RpcHooks {
  /** A notification arrived, by method name, with its params when it has an object. */
  notify(method: string, params: Record<string, unknown>): void;
  /** The connection ended. Every call still waiting has failed. */
  down(): void;
}

const CALL_TIMEOUT_MS = 10_000;

export interface Opening {
  ready: Promise<Rpc>;
  /** Give up: closes the socket whether or not hello has been answered. `ready` rejects. */
  cancel(): void;
}

/** Connect, say hello, and resolve with a handle for calls. Rejects when the daemon is not there. */
export function connectRpc(open: OpenDaemon, hooks: RpcHooks): Opening {
  let cancel = (): void => undefined;
  const ready = new Promise<Rpc>((resolve, reject) => {
    const splitter = createLineSplitter();
    const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    let next = 0;
    let ready = false;
    let ended = false;
    let socket: DaemonSocket | null = null;

    function end(): void {
      if (ended) return;
      ended = true;
      socket?.destroy();
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("the daemon connection ended"));
      }
      pending.clear();
      if (ready) hooks.down();
      else reject(new Error("the daemon is not reachable"));
    }

    function call(method: string, params: Record<string, unknown>): Promise<unknown> {
      return new Promise((res, rej) => {
        if (ended || socket === null) {
          rej(new Error("the daemon connection ended"));
          return;
        }
        const id = `gw:rpc:${next++}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`${method} timed out`));
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve: res, reject: rej, timer });
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    }

    function line(text: string): void {
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
        message = parsed as Record<string, unknown>;
      } catch {
        return;
      }
      const id = message["id"];
      if (typeof id === "string" && pending.has(id)) {
        const p = pending.get(id);
        pending.delete(id);
        if (p === undefined) return;
        clearTimeout(p.timer);
        const error = message["error"];
        if (typeof error === "object" && error !== null) {
          const e = error as Record<string, unknown>;
          p.reject(new RpcError(typeof e["code"] === "number" ? e["code"] : -1, typeof e["message"] === "string" ? e["message"] : "error", e["data"]));
        } else p.resolve(message["result"]);
      } else if (id === undefined && typeof message["method"] === "string") {
        const params = message["params"];
        hooks.notify(message["method"], typeof params === "object" && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : {});
      }
    }

    socket = open({
      open() {
        call("hello", { protocol_major: PROTOCOL_MAJOR, protocol_minor: PROTOCOL_MINOR, client: "gateway" }).then(
          () => {
            ready = true;
            resolve({
              call,
              close() {
                ended = true;
                socket?.destroy();
                for (const [, p] of pending) {
                  clearTimeout(p.timer);
                  p.reject(new Error("the daemon connection ended"));
                }
                pending.clear();
              },
            });
          },
          () => end(),
        );
      },
      data(chunk) {
        for (const text of splitter.push(chunk)) line(text);
      },
      close: end,
      error: end,
    });
    cancel = end;
  });
  return { ready, cancel: () => cancel() };
}
