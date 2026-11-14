/** Frames held in memory for a side that is not connected (ADR-051). Nothing here touches a disk. */

export interface QueueOptions {
  ttlMs: number;
  maxFrames: number;
  maxBytes: number;
}

export interface FrameQueue {
  push(frame: Uint8Array, now: number): void;
  /** Take every frame that has not expired, oldest first, and empty the queue. */
  drain(now: number): Uint8Array[];
  /** Drop expired frames. */
  prune(now: number): void;
  /** The held frames, without taking them. */
  peek(): Uint8Array[];
  clear(): void;
  readonly frames: number;
  readonly bytes: number;
}

export function createQueue(opts: QueueOptions): FrameQueue {
  let items: { frame: Uint8Array; at: number }[] = [];
  let bytes = 0;

  function expire(now: number): void {
    while (items.length > 0 && now - items[0]!.at >= opts.ttlMs) {
      bytes -= items.shift()!.frame.length;
    }
  }

  return {
    push(frame, now) {
      expire(now);
      if (frame.length > opts.maxBytes) return;
      items.push({ frame, at: now });
      bytes += frame.length;
      while (items.length > opts.maxFrames || bytes > opts.maxBytes) {
        bytes -= items.shift()!.frame.length;
      }
    },
    drain(now) {
      expire(now);
      const out = items.map((i) => i.frame);
      items = [];
      bytes = 0;
      return out;
    },
    prune(now) {
      expire(now);
    },
    peek() {
      return items.map((i) => i.frame);
    },
    clear() {
      items = [];
      bytes = 0;
    },
    get frames() {
      return items.length;
    },
    get bytes() {
      return bytes;
    },
  };
}
