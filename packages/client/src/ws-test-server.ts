import type { AddressInfo } from "node:net";

import { WebSocketServer, type WebSocket } from "ws";

import type { Dial } from "./link.ts";
import { makePeer, queue, type Peer, type Rig } from "./link-contract.ts";
import { wsDial } from "./ws-link.ts";

export interface WsServer extends Rig {
  url: string;
  /** The next raw socket the server accepts, for tests that break the framing. */
  acceptRaw(): Promise<WebSocket>;
  /** How many connections the server has seen. */
  readonly connections: number;
}

/** A WebSocket server on 127.0.0.1. `onConnection` runs for each socket before the peer is queued. */
export async function startWsServer(onConnection?: (socket: WebSocket) => void): Promise<WsServer> {
  const peers = queue<Peer>();
  const raws = queue<WebSocket>();
  let connections = 0;
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  wss.on("connection", (socket) => {
    connections += 1;
    socket.on("error", () => {
      // The client may close while a reply is still being written.
    });
    const { peer, feed } = makePeer(
      (line) => socket.send(line),
      (code) => socket.close(code ?? 1000),
    );
    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        feed(data.toString());
      }
    });
    onConnection?.(socket);
    peers.push(peer);
    raws.push(socket);
  });
  const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  const dial: Dial = wsDial(url);
  return {
    url,
    dial,
    accept: peers.next,
    acceptRaw: raws.next,
    get connections() {
      return connections;
    },
    async stop() {
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
