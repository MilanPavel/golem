import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { bindPointer, drainPointer, nextOffset } from "./screen.ts";

const up = "\u001b[<64;1;1M";
const down = "\u001b[<65;8;4M";

test("a wheel notch changes the transcript offset", () => {
  assert.equal(nextOffset(0, 1), 3);
  assert.equal(nextOffset(2, -1), 0);
  assert.equal(nextOffset(0, -1), 0);
});

test("pointer reports drain wheel events and keep keys", () => {
  assert.deepEqual(drainPointer(up), { steps: [1], forward: "", rest: "" });
  assert.deepEqual(drainPointer(down), { steps: [-1], forward: "", rest: "" });
  assert.deepEqual(drainPointer(`ab${up}c`), { steps: [1], forward: "abc", rest: "" });
  assert.deepEqual(drainPointer("\u001b[A"), { steps: [], forward: "\u001b[A", rest: "" });
  assert.deepEqual(drainPointer("\u001b[27;2;13~"), { steps: [], forward: "\u001b[13;2u", rest: "" });
  assert.deepEqual(drainPointer("\u001b[27;2"), { steps: [], forward: "", rest: "\u001b[27;2" });
  assert.deepEqual(drainPointer("a\u001b[27;2;13~b"), { steps: [], forward: "a\u001b[13;2ub", rest: "" });
  assert.deepEqual(drainPointer("\u001b[<0;2;3M"), { steps: [], forward: "", rest: "" });
  assert.deepEqual(drainPointer("\u001b[<64;1;1m"), { steps: [], forward: "", rest: "" });
  assert.deepEqual(drainPointer("\u001b[<68;1;1M"), { steps: [1], forward: "", rest: "" });
  assert.deepEqual(drainPointer("\u001b[<64;1"), { steps: [], forward: "", rest: "\u001b[<64;1" });
  assert.deepEqual(drainPointer("hi\u001b"), { steps: [], forward: "hi", rest: "\u001b" });
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
  assert.deepEqual(written, ["\u001b[?1006h\u001b[?1000h"]);
  pointer.restore();
  pointer.restore();
  assert.deepEqual(written, ["\u001b[?1006h\u001b[?1000h", "\u001b[?1000l\u001b[?1006l"]);
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
  assert.equal(written.at(-1), "\u001b[?1000l\u001b[?1006l");

  pointer.stdin.setRawMode(true);
  assert.equal(stdin.listenerCount("data"), 1);
  assert.equal(written.at(-1), "\u001b[?1006h\u001b[?1000h");
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
