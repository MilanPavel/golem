import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { linkContract, makePeer, queue, type Peer, type Rig } from "./link-contract.ts";
import { unixDial } from "./unix-link.ts";

async function unixRig(): Promise<Rig> {
  const dir = mkdtempSync(path.join(tmpdir(), "golem-link-"));
  const socketPath = path.join(dir, "s.sock");
  const peers = queue<Peer>();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {
      // The client may close while a reply is still being written.
    });
    const { peer, feed } = makePeer(
      (line) => socket.write(`${line}\n`),
      () => socket.destroy(),
    );
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        feed(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    });
    peers.push(peer);
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    dial: unixDial(socketPath),
    accept: peers.next,
    async stop() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

linkContract("unix link", unixRig);
