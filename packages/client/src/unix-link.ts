import net from "node:net";

import type { Dial, Link } from "./link.ts";

/** A dial that connects to the daemon's Unix socket. */
export function unixDial(socketPath: string): Dial {
  return () => unixLink(socketPath);
}

function unixLink(socketPath: string): Link {
  const socket = net.createConnection(socketPath);
  const decoder = new TextDecoder("utf-8");
  const openListeners: Array<() => void> = [];
  const lineListeners: Array<(line: string) => void> = [];
  const closeListeners: Array<(error?: Error) => void> = [];
  let buffer = "";
  let lastError: Error | undefined;
  let closed = false;

  socket.on("error", (error: Error) => {
    lastError = error;
  });
  socket.on("data", (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        for (const listener of lineListeners) {
          listener(line);
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  socket.on("connect", () => {
    for (const listener of openListeners) {
      listener();
    }
  });
  socket.on("close", () => {
    if (closed) {
      return;
    }
    closed = true;
    for (const listener of closeListeners) {
      listener(lastError);
    }
  });

  return {
    send(line: string): void {
      socket.write(`${line}\n`);
    },
    close(error?: Error): void {
      socket.destroy(error);
    },
    onOpen(listener): void {
      openListeners.push(listener);
    },
    onLine(listener): void {
      lineListeners.push(listener);
    },
    onClose(listener): void {
      closeListeners.push(listener);
    },
  };
}
