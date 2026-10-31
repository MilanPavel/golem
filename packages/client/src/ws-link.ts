import type { Dial, Link } from "./link.ts";

const NORMAL_CLOSE = 1000;
const OPEN = 1;

/** A dial that connects to the web gateway at `url`, a `ws://` or `wss://` address. */
export function wsDial(url: string): Dial {
  return () => wsLink(url);
}

function wsLink(url: string): Link {
  const openListeners: Array<() => void> = [];
  const lineListeners: Array<(line: string) => void> = [];
  const closeListeners: Array<(error?: Error, code?: number) => void> = [];
  let closed = false;
  let closing = false;
  let ws: WebSocket | undefined;

  function finish(error: Error | undefined, code: number | undefined): void {
    if (closed) {
      return;
    }
    closed = true;
    for (const listener of closeListeners) {
      listener(error, code);
    }
  }

  /**
   * Ends the link at once, as destroying a socket does. A browser fires `close` only after the closing
   * handshake, which on a dead network (a laptop that slept) can take minutes, and the client would not
   * redial after a heartbeat timeout until then. Events that arrive later are ignored.
   */
  function close(error?: Error): void {
    if (closing) {
      return;
    }
    closing = true;
    ws?.close(NORMAL_CLOSE);
    queueMicrotask(() => finish(error, undefined));
  }

  try {
    const socket = new globalThis.WebSocket(url);
    ws = socket;
    socket.addEventListener("open", () => {
      if (closing) {
        return;
      }
      for (const listener of openListeners) {
        listener();
      }
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== "string" || data.includes("\n") || data.includes("\r")) {
        close(new Error("bad frame"));
        return;
      }
      if (data.length === 0 || closing) {
        return;
      }
      for (const listener of lineListeners) {
        listener(data);
      }
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      closing = true;
      finish(event.wasClean ? undefined : new Error("connection lost"), event.code);
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    queueMicrotask(() => finish(failure, undefined));
  }

  return {
    send(line: string): void {
      if (ws !== undefined && ws.readyState === OPEN) {
        ws.send(line);
      }
    },
    close,
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
