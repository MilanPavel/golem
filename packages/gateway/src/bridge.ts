import { MAX_MESSAGE_BYTES, filterMessage } from "./framing.ts";
import { createLineSplitter } from "./lines.ts";

/** Browser buffered amount above which reading from the daemon pauses. */
export const PAUSE_ABOVE_BYTES = 4 * 1024 * 1024;
/** Bytes queued toward the daemon and not yet written, above which the connection is closed. */
export const MAX_DAEMON_BACKLOG_BYTES = 4 * 1024 * 1024;
const MAX_QUEUE_BYTES = MAX_MESSAGE_BYTES * 2;

export const CLOSE_POLICY = 1008;
export const CLOSE_DAEMON_DOWN = 1013;
export const CLOSE_GOING_AWAY = 1001;

/** Everything a bridge does to the outside world. */
export interface BridgeIO {
  toBrowser(text: string): void;
  browserBuffered(): number;
  closeBrowser(code: number, reason: string): void;
  toDaemon(line: string): void;
  daemonBacklog(): number;
  closeDaemon(): void;
  pauseDaemon(): void;
  resumeDaemon(): void;
}

/** Events in, calls on `BridgeIO` out. The bridge never sends anything on its own. */
export interface Bridge {
  browserMessage(data: string | ArrayBuffer | Uint8Array): void;
  browserDrain(): void;
  browserClosed(): void;
  daemonOpen(): void;
  daemonData(chunk: Uint8Array): void;
  daemonClosed(): void;
  daemonFailed(): void;
}

const encoder = new TextEncoder();

/** The state of one browser-to-daemon connection. */
export function createBridge(io: BridgeIO): Bridge {
  const splitter = createLineSplitter();
  let queue: string[] = [];
  let queued = 0;
  let open = false;
  let closed = false;
  let paused = false;

  function closeBoth(code: number, reason: string): void {
    if (closed) return;
    closed = true;
    queue = [];
    io.closeBrowser(code, reason);
    io.closeDaemon();
  }

  function send(line: string): void {
    if (open) {
      io.toDaemon(line);
      if (io.daemonBacklog() > MAX_DAEMON_BACKLOG_BYTES) closeBoth(CLOSE_POLICY, "too much unread input");
      return;
    }
    queued += encoder.encode(line).byteLength;
    if (queued > MAX_QUEUE_BYTES) {
      closeBoth(CLOSE_POLICY, "too much unread input");
      return;
    }
    queue.push(line);
  }

  function lines(found: string[]): void {
    for (const line of found) {
      if (closed) return;
      io.toBrowser(line);
    }
  }

  return {
    browserMessage(data) {
      if (closed) return;
      const result = filterMessage(data);
      if (result.kind === "forward") send(result.line);
      else if (result.kind === "deny") {
        if (result.reply !== null) io.toBrowser(result.reply);
      } else closeBoth(CLOSE_POLICY, result.reason);
    },
    browserDrain() {
      if (closed || !paused) return;
      if (io.browserBuffered() <= PAUSE_ABOVE_BYTES) {
        paused = false;
        io.resumeDaemon();
      }
    },
    browserClosed() {
      if (closed) return;
      closed = true;
      queue = [];
      io.closeDaemon();
    },
    daemonOpen() {
      if (closed || open) return;
      open = true;
      const pending = queue;
      queue = [];
      for (const line of pending) {
        if (closed) return;
        send(line);
      }
    },
    daemonData(chunk) {
      if (closed) return;
      lines(splitter.push(chunk));
      if (!closed && !paused && io.browserBuffered() > PAUSE_ABOVE_BYTES) {
        paused = true;
        io.pauseDaemon();
      }
    },
    daemonClosed() {
      if (closed) return;
      lines(splitter.end());
      if (closed) return;
      closed = true;
      io.closeBrowser(CLOSE_GOING_AWAY, "daemon closed");
    },
    daemonFailed() {
      if (closed) return;
      closed = true;
      io.closeBrowser(CLOSE_DAEMON_DOWN, "golem daemon is not running");
    },
  };
}
