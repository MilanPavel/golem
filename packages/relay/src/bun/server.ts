import type { ServerWebSocket } from "bun";

import { MAX_FRAME_BYTES, createHub } from "../core.ts";
import type { Conn, Handler, Hub, HubOptions, Logger, Role } from "../core.ts";

export interface RelayOptions extends HubOptions {
  /** Port to listen on. 0 picks a free one, reported in `port`. */
  port: number;
  hostname?: string;
  /** Read the client address from the first `X-Forwarded-For` entry. Only behind a proxy you trust. */
  trustProxy?: boolean;
  log?: Logger;
}

export interface Relay {
  port: number;
  hub: Hub;
  stop(): void;
}

interface SocketData {
  role: Role;
  ip: string;
  handler?: Handler;
}

/** Close a link whose send buffer is this full: its reader is not keeping up. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

function clientIp(req: Request, ip: string | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return ip ?? "unknown";
}

/** Serve the relay: `/healthz`, `/v1/mac`, and `/v1/device`. */
export function startRelay(opts: RelayOptions): Relay {
  const hub = createHub(opts);
  const sweeper = setInterval(() => hub.sweep(), 30_000);

  const server = Bun.serve<SocketData>({
    port: opts.port,
    hostname: opts.hostname ?? "127.0.0.1",
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/healthz") {
        return Response.json({ ok: true, ...hub.stats() });
      }
      const role: Role | null = url.pathname === "/v1/mac" ? "mac" : url.pathname === "/v1/device" ? "device" : null;
      if (role === null) return new Response("not found", { status: 404 });
      const ip = clientIp(req, srv.requestIP(req)?.address, opts.trustProxy ?? false);
      if (srv.upgrade(req, { data: { role, ip } })) return undefined;
      return new Response("expected a WebSocket", { status: 426 });
    },
    websocket: {
      maxPayloadLength: MAX_FRAME_BYTES * 2,
      idleTimeout: 120,
      sendPings: true,
      open(ws: ServerWebSocket<SocketData>) {
        const conn: Conn = {
          send(data) {
            if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES) {
              ws.close(1013);
              return;
            }
            ws.send(data);
          },
          close(code, reason) {
            ws.close(code, reason);
          },
        };
        ws.data.handler = hub.open(conn, ws.data.role, ws.data.ip);
      },
      message(ws, message) {
        ws.data.handler?.message(typeof message === "string" ? message : new Uint8Array(message));
      },
      ping(ws) {
        ws.data.handler?.touch();
      },
      pong(ws) {
        ws.data.handler?.touch();
      },
      close(ws) {
        ws.data.handler?.close();
      },
    },
  });

  return {
    port: server.port ?? 0,
    hub,
    stop() {
      clearInterval(sweeper);
      hub.shutdown();
      void server.stop(true);
    },
  };
}
