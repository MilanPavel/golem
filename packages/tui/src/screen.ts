import { Readable } from "node:stream";

const ESC = "\u001b";
const ENABLE_MOUSE = `${ESC}[?1006h${ESC}[?1000h`;
const DISABLE_MOUSE = `${ESC}[?1000l${ESC}[?1006l`;
const HOLD_MS = 30;

export const WHEEL_LINES = 3;

export type WheelSubscribe = (listener: (steps: number) => void) => () => void;

export function nextOffset(offset: number, steps: number): number {
  return Math.max(0, offset + steps * WHEEL_LINES);
}

export function drainPointer(input: string): { steps: number[]; forward: string; rest: string } {
  const steps: number[] = [];
  let forward = "";
  let index = 0;
  while (index < input.length) {
    const start = input.indexOf(ESC, index);
    if (start === -1) {
      forward += input.slice(index);
      return { steps, forward, rest: "" };
    }
    forward += input.slice(index, start);
    const mouse = readMouse(input, start);
    if (mouse.kind === "more") {
      return { steps, forward, rest: input.slice(start) };
    }
    if (mouse.kind === "event") {
      if (mouse.steps !== 0) {
        steps.push(mouse.steps);
      }
      index = mouse.next;
      continue;
    }
    const shiftEnter = readShiftEnter(input, start);
    if (shiftEnter === "more") {
      return { steps, forward, rest: input.slice(start) };
    }
    if (typeof shiftEnter === "number") {
      // xterm modifyOtherKeys. Ink already understands the kitty form as Shift-Enter.
      forward += `${ESC}[13;2u`;
      index = shiftEnter;
      continue;
    }
    forward += ESC;
    index = start + 1;
  }
  return { steps, forward, rest: "" };
}

type MouseRead =
  | { kind: "more" }
  | { kind: "no" }
  | { kind: "event"; next: number; steps: number };

const SHIFT_ENTER = `${ESC}[27;2;13~`;

/** A finished sequence, a prefix that still needs bytes, or something else. */
function readShiftEnter(input: string, start: number): "more" | "no" | number {
  const slice = input.slice(start, start + SHIFT_ENTER.length);
  if (slice === SHIFT_ENTER) {
    return start + SHIFT_ENTER.length;
  }
  if (SHIFT_ENTER.startsWith(slice) && start + slice.length === input.length) {
    return "more";
  }
  return "no";
}

function readMouse(input: string, start: number): MouseRead {
  const marker = `${ESC}[<`;
  if (input.length < start + marker.length) {
    return marker.startsWith(input.slice(start)) ? { kind: "more" } : { kind: "no" };
  }
  if (!input.startsWith(marker, start)) {
    return { kind: "no" };
  }
  let index = start + marker.length;
  const number = (): "more" | "bad" | number => {
    const begin = index;
    while (index < input.length && input.charCodeAt(index) >= 48 && input.charCodeAt(index) <= 57) {
      index += 1;
    }
    if (begin === index) {
      return index >= input.length ? "more" : "bad";
    }
    return Number(input.slice(begin, index));
  };
  const button = number();
  if (button === "more") {
    return { kind: "more" };
  }
  if (button === "bad") {
    return { kind: "no" };
  }
  if (index >= input.length) {
    return { kind: "more" };
  }
  if (input[index] !== ";") {
    return { kind: "no" };
  }
  index += 1;
  const column = number();
  if (column === "more") {
    return { kind: "more" };
  }
  if (column === "bad") {
    return { kind: "no" };
  }
  if (index >= input.length) {
    return { kind: "more" };
  }
  if (input[index] !== ";") {
    return { kind: "no" };
  }
  index += 1;
  const row = number();
  if (row === "more") {
    return { kind: "more" };
  }
  if (row === "bad") {
    return { kind: "no" };
  }
  if (index >= input.length) {
    return { kind: "more" };
  }
  const end = input[index];
  if (end !== "M" && end !== "m") {
    return { kind: "no" };
  }
  const base = button & ~0b11100;
  const steps = end === "M" && base === 64 ? 1 : end === "M" && base === 65 ? -1 : 0;
  return { kind: "event", next: index + 1, steps };
}

export function bindPointer(
  stdin: NodeJS.ReadStream,
  write: (data: string) => void,
  tty: boolean,
): { stdin: NodeJS.ReadStream; subscribe: WheelSubscribe; restore: () => void } {
  if (!tty) {
    return {
      stdin,
      subscribe: () => () => undefined,
      restore: () => undefined,
    };
  }
  const listeners = new Set<(steps: number) => void>();
  const proxy = new Readable({ read() {} });
  const stream = proxy as NodeJS.ReadStream;
  const setProxyEncoding = stream.setEncoding.bind(stream);
  stream.setEncoding = (encoding: BufferEncoding) => {
    stdin.setEncoding(encoding);
    return setProxyEncoding(encoding);
  };
  stream.ref = () => {
    stdin.ref();
    return stream;
  };
  stream.unref = () => {
    stdin.unref();
    return stream;
  };
  stream.isTTY = true;
  let pending = "";
  let timer: NodeJS.Timeout | undefined;
  let restored = false;
  let capturing = true;
  const publish = (steps: number) => {
    for (const listener of listeners) {
      listener(steps);
    }
  };
  const onData = (chunk: Buffer | string) => {
    if (restored) {
      return;
    }
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const parsed = drainPointer(pending);
    pending = parsed.rest;
    for (const steps of parsed.steps) {
      publish(steps);
    }
    if (parsed.forward.length > 0) {
      proxy.push(parsed.forward);
    }
    if (pending.length > 0) {
      timer = setTimeout(() => {
        timer = undefined;
        if (pending.length === 0 || restored) {
          return;
        }
        const held = pending;
        pending = "";
        proxy.push(held);
      }, HOLD_MS);
      timer.unref();
    }
  };
  // An editor shares this tty. A live data listener consumes the bytes Vim is waiting for,
  // so typing lags and :wq never returns to the chat. Raw mode off means Ink has handed the terminal over.
  const stopCapture = (): void => {
    if (!capturing) {
      return;
    }
    capturing = false;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pending = "";
    stdin.off("data", onData);
    stdin.pause();
    write(DISABLE_MOUSE);
  };
  const startCapture = (): void => {
    if (capturing || restored) {
      return;
    }
    capturing = true;
    stdin.on("data", onData);
    stdin.resume();
    write(ENABLE_MOUSE);
  };
  stream.setRawMode = (enabled: boolean) => {
    stdin.setRawMode(enabled);
    if (enabled) {
      startCapture();
      stdin.resume();
    } else {
      stopCapture();
    }
    return stream;
  };
  stdin.on("data", onData);
  write(ENABLE_MOUSE);
  return {
    stdin: stream,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restore() {
      if (restored) {
        return;
      }
      restored = true;
      stopCapture();
    },
  };
}
