import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { bindPointer, drainPointer, nextOffset, type PointerEvent } from "./screen.ts";

const up = "\u001b[<64;1;1M";
const ENABLE = "\u001b[?1006h\u001b[?1000h\u001b[?1002h";
const DISABLE = "\u001b[?1002l\u001b[?1000l\u001b[?1006l";
const down = "\u001b[<65;8;4M";

test("a wheel notch changes the transcript offset", () => {
  assert.equal(nextOffset(0, 1), 3);
  assert.equal(nextOffset(2, -1), 0);
  assert.equal(nextOffset(0, -1), 0);
});

test("pointer reports drain wheel events and keep keys", () => {
  assert.deepEqual(drainPointer(up), { steps: [1], pointer: [], forward: "", rest: "" });
  assert.deepEqual(drainPointer(down), { steps: [-1], pointer: [], forward: "", rest: "" });
  assert.deepEqual(drainPointer(`ab${up}c`), { steps: [1], pointer: [], forward: "abc", rest: "" });
  assert.deepEqual(drainPointer("\u001b[A"), { steps: [], pointer: [], forward: "\u001b[A", rest: "" });
  assert.deepEqual(drainPointer("\u001b[27;2;13~"), { steps: [], pointer: [], forward: "\u001b[13;2u", rest: "" });
  assert.deepEqual(drainPointer("\u001b[27;2"), { steps: [], pointer: [], forward: "", rest: "\u001b[27;2" });
  assert.deepEqual(drainPointer("a\u001b[27;2;13~b"), { steps: [], pointer: [], forward: "a\u001b[13;2ub", rest: "" });
  assert.deepEqual(drainPointer("\u001b[<64;1;1m"), { steps: [], pointer: [], forward: "", rest: "" });
  assert.deepEqual(drainPointer("\u001b[<68;1;1M"), { steps: [1], pointer: [], forward: "", rest: "" });
  assert.deepEqual(drainPointer("\u001b[<64;1"), { steps: [], pointer: [], forward: "", rest: "\u001b[<64;1" });
  assert.deepEqual(drainPointer("hi\u001b"), { steps: [], pointer: [], forward: "hi", rest: "\u001b" });
});

test("a tty enables mouse tracking and forwards keys", async () => {
  const written: string[] = [];
  const stdin = new PassThrough();
  const pointer = bindPointer(stdin as unknown as NodeJS.ReadStream, (data) => written.push(data), true);
  const keys: string[] = [];
  const steps: number[] = [];
  pointer.subscribe((value) => steps.push(value));
  pointer.stdin.on("data", (chunk: Buffer | string) => {
    keys.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });
  stdin.write(up);
  stdin.write("x");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(steps, [1]);
  assert.deepEqual(keys, ["x"]);
  assert.deepEqual(written, [ENABLE]);
  pointer.restore();
  pointer.restore();
  assert.deepEqual(written, [ENABLE, DISABLE]);
});

test("raw mode off stops reading so an editor can take the keys", async () => {
  const written: string[] = [];
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
  stdin.setRawMode = () => stdin;
  const pointer = bindPointer(stdin, (data) => written.push(data), true);
  const keys: string[] = [];
  pointer.stdin.on("data", (chunk: Buffer | string) => {
    keys.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });
  pointer.stdin.setRawMode(false);
  assert.equal(stdin.listenerCount("data"), 0);
  assert.equal(written.at(-1), DISABLE);

  pointer.stdin.setRawMode(true);
  assert.equal(stdin.listenerCount("data"), 1);
  assert.equal(written.at(-1), ENABLE);
  stdin.write("x");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(keys, ["x"]);
  pointer.restore();
});

test("a pipe does not touch the pointer", () => {
  const written: string[] = [];
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
  const pointer = bindPointer(stdin, (data) => written.push(data), false);
  assert.equal(pointer.stdin, stdin);
  pointer.restore();
  assert.deepEqual(written, []);
});

test("a left press, drag, and release become pointer events at 0-based cells", () => {
  const drag = drainPointer("\u001b[<0;2;3M\u001b[<32;5;3M\u001b[<32;9;4M\u001b[<0;9;4m");
  assert.deepEqual(drag, {
    steps: [],
    pointer: [
      { kind: "down", row: 2, column: 1 },
      { kind: "drag", row: 2, column: 4 },
      { kind: "drag", row: 3, column: 8 },
      { kind: "up", row: 3, column: 8 },
    ],
    forward: "",
    rest: "",
  });
});

test("other buttons, modified clicks, and the wheel are not pointer events", () => {
  for (const event of ["\u001b[<1;2;3M", "\u001b[<2;2;3M", "\u001b[<34;2;3M", "\u001b[<4;2;3M", "\u001b[<16;2;3M", "\u001b[<8;2;3m"]) {
    assert.deepEqual(drainPointer(event), { steps: [], pointer: [], forward: "", rest: "" }, event);
  }
  assert.deepEqual(drainPointer("\u001b[<64;2;3M").pointer, []);
});

test("a press split across chunks waits for the rest", () => {
  const first = drainPointer("x\u001b[<0;12");
  assert.deepEqual(first, { steps: [], pointer: [], forward: "x", rest: "\u001b[<0;12" });
  assert.deepEqual(drainPointer(`${first.rest};7M`).pointer, [{ kind: "down", row: 6, column: 11 }]);
});

test("pointer events reach their own listeners, and the wheel still reaches its own", async () => {
  const stdin = new PassThrough();
  const pointer = bindPointer(stdin as unknown as NodeJS.ReadStream, () => undefined, true);
  const events: PointerEvent[] = [];
  const steps: number[] = [];
  const stop = pointer.subscribePointer((event) => events.push(event));
  pointer.subscribe((value) => steps.push(value));
  stdin.write("\u001b[<0;1;1M");
  stdin.write("\u001b[<0;1;1m");
  stdin.write(up);
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  stdin.write("\u001b[<0;1;1M");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    { kind: "down", row: 0, column: 0 },
    { kind: "up", row: 0, column: 0 },
  ]);
  assert.deepEqual(steps, [1]);
  pointer.restore();
});
