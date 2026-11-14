import { expect, test } from "bun:test";

import { createBucket, createIpGate } from "./limits.ts";
import { createQueue } from "./queue.ts";

const opts = { ttlMs: 1000, maxFrames: 3, maxBytes: 10 };

test("frames come out oldest first and only once", () => {
  const q = createQueue(opts);
  q.push(new Uint8Array([1]), 0);
  q.push(new Uint8Array([2]), 1);
  expect(q.drain(2).map((f) => f[0])).toEqual([1, 2]);
  expect(q.drain(3)).toEqual([]);
});

test("a frame expires at the TTL", () => {
  const q = createQueue(opts);
  q.push(new Uint8Array([1]), 0);
  q.push(new Uint8Array([2]), 900);
  expect(q.drain(1000).map((f) => f[0])).toEqual([2]);
});

test("the oldest frames go when the count or the bytes run over", () => {
  const q = createQueue(opts);
  for (let i = 0; i < 5; i++) q.push(new Uint8Array([i]), i);
  expect(q.frames).toBe(3);
  q.push(new Uint8Array(9), 6);
  expect(q.frames).toBe(2);
  expect(q.bytes).toBe(10);
  q.push(new Uint8Array(11), 7);
  expect(q.frames).toBe(2);
});

test("a bucket refills with time", () => {
  const b = createBucket(10, 2, 0);
  expect([b.take(1, 0), b.take(1, 0), b.take(1, 0)]).toEqual([true, true, false]);
  expect(b.take(1, 150)).toBe(true);
});

test("the IP gate counts a minute and open connections", () => {
  const g = createIpGate(2, 5);
  expect([g.admit("a", 0), g.admit("a", 1), g.admit("a", 2)]).toEqual([true, true, false]);
  expect(g.admit("b", 2)).toBe(true);
  expect(g.admit("a", 61_000)).toBe(true);
});
