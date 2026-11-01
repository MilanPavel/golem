import { createConnection } from "node:net";
import type { Socket } from "node:net";

import {
  CLOSE_DAEMON_DOWN,
  MAX_MESSAGE_BYTES,
  checkRequest,
  checkUpgrade,
  createBridge,
  createSessionStore,
  exchangeToken,
  isSecretShape,
  withSecurityHeaders,
} from "../core.ts";
import type { Bridge, SessionStore } from "../core.ts";

export interface GatewayOptions {
  port: number;
  socketPath: string;
  token: string;
  sessions?: SessionStore;
  /** Most live WebSockets at once. Default 16. */
  maxSockets?: number;
}

export interface Gateway {
  port: number;
  stop(): Promise<void>;
}

interface SocketData {
  refused: boolean;
  bridge?: Bridge;
  daemon?: Socket;
}

const DEFAULT_MAX_SOCKETS = 16;

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}

/** Serve the gateway on 127.0.0.1. Port 0 picks a free port, reported in `port`. */
export function startGateway(opts: GatewayOptions): Gateway {
  if (!isSecretShape(opts.token)) throw new Error("the gateway's login token is malformed");
  if (opts.socketPath.length === 0) throw new Error("the daemon's socket path is empty");
  const sessions = opts.sessions ?? createSessionStore();
  const maxSockets = opts.maxSockets ?? DEFAULT_MAX_SOCKETS;
  const live = new Set<Bun.ServerWebSocket<SocketData>>();
  let counted = 0;

  function health(req: Request, port: number): Response {
    if (req.method !== "GET") return text(405, "method not allowed");
    const checked = checkRequest(req, port, { requireOrigin: false });
    if (!checked.ok) return text(checked.status, checked.reason);
    return Response.json({ golem: "web", pid: process.pid }, { headers: { "Cache-Control": "no-store" } });
  }

  function upgrade(req: Request, server: Bun.Server<SocketData>): Response | undefined {
    const port = server.port ?? 0;
    if (req.method !== "GET") return text(405, "method not allowed");
    const origin = checkRequest(req, port, { requireOrigin: true });
    if (!origin.ok) return text(origin.status, origin.reason);
    if (counted >= maxSockets) return text(503, "too many connections");
    const login = checkUpgrade(req, port, sessions);
    if (!login.ok) {
      if (login.status !== 401) return text(login.status, login.reason);
      return server.upgrade(req, { data: { refused: true } }) ? undefined : text(400, "upgrade failed");
    }
    counted += 1;
    if (server.upgrade(req, { data: { refused: false } })) return undefined;
    counted -= 1;
    return text(400, "upgrade failed");
  }

  function connectDaemon(ws: Bun.ServerWebSocket<SocketData>): void {
    let socket: Socket;
    try {
      socket = createConnection(opts.socketPath);
    } catch {
      // Some bad paths throw at once instead of emitting "error".
      ws.close(CLOSE_DAEMON_DOWN, "golem daemon is not running");
      return;
    }
    let connected = false;
    const bridge = createBridge({
      toBrowser: (t) => void ws.send(t),
      browserBuffered: () => ws.getBufferedAmount(),
      closeBrowser: (code, reason) => ws.close(code, reason),
      toDaemon: (line) => void socket.write(line),
      daemonBacklog: () => socket.writableLength,
      closeDaemon: () => void socket.destroy(),
      pauseDaemon: () => void socket.pause(),
      resumeDaemon: () => void socket.resume(),
    });
    ws.data.bridge = bridge;
    ws.data.daemon = socket;
    socket.on("connect", () => {
      connected = true;
      bridge.daemonOpen();
    });
    socket.on("data", (chunk) => bridge.daemonData(chunk));
    socket.on("close", () => {
      if (connected) bridge.daemonClosed();
    });
    socket.on("error", () => {
      if (!connected) bridge.daemonFailed();
    });
  }

  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: opts.port,
    async fetch(req, srv) {
      const port = srv.port ?? 0;
      const path = new URL(req.url).pathname;
      let res: Response | undefined;
      if (path === "/healthz") res = health(req, port);
      else if (path === "/auth/exchange") res = await exchangeToken(req, port, opts.token, sessions);
      else if (path === "/ws") res = upgrade(req, srv);
      else res = text(404, "not found");
      return res === undefined ? undefined : withSecurityHeaders(res);
    },
    websocket: {
      maxPayloadLength: MAX_MESSAGE_BYTES,
      idleTimeout: 120,
      sendPings: true,
      perMessageDeflate: false,
      open(ws) {
        if (ws.data.refused) {
          ws.close(4401, "login required");
          return;
        }
        live.add(ws);
        connectDaemon(ws);
      },
      message(ws, data) {
        ws.data.bridge?.browserMessage(data);
      },
      drain(ws) {
        ws.data.bridge?.browserDrain();
      },
      close(ws) {
        if (ws.data.refused) return;
        live.delete(ws);
        counted -= 1;
        ws.data.bridge?.browserClosed();
      },
    },
  });

  return {
    port: server.port ?? 0,
    async stop() {
      for (const ws of live) {
        ws.data.daemon?.destroy();
        ws.close(1001, "gateway stopping");
      }
      // In Bun 1.3.10 the promise from stop(true) never settles once the server itself has closed a
      // WebSocket. The listener is closed at once, so do not wait on it for long.
      await Promise.race([server.stop(true), new Promise((resolve) => setTimeout(resolve, 200))]);
    },
  };
}
