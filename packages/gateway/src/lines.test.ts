import assert from "node:assert/strict";
import { test } from "node:test";

import { createLineSplitter } from "./core.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

test("one chunk with several lines", () => {
  const s = createLineSplitter();
  assert.deepEqual(s.push(bytes('{"a":1}\n{"b":2}\n{"c":3}\n')), ['{"a":1}', '{"b":2}', '{"c":3}']);
  assert.deepEqual(s.end(), []);
});

test("a line split across chunks", () => {
  const s = createLineSplitter();
  assert.deepEqual(s.push(bytes('{"a":')), []);
  assert.deepEqual(s.push(bytes('1}\n{"b"')), ['{"a":1}']);
  assert.deepEqual(s.push(bytes(":2}\n")), ['{"b":2}']);
});

for (const ch of ["ž", "🙂"]) {
  test(`a multi-byte character ${ch} cut mid-sequence stays whole`, () => {
    const all = bytes(`x${ch}y\n`);
    for (let cut = 1; cut < all.length; cut++) {
      const s = createLineSplitter();
      const out = [...s.push(all.slice(0, cut)), ...s.push(all.slice(cut))];
      assert.deepEqual(out, [`x${ch}y`], `cut at ${cut}`);
    }
  });
}

test("\\r\\n ends a line and one trailing \\r is stripped", () => {
  const s = createLineSplitter();
  assert.deepEqual(s.push(bytes("a\r\nb\r\n")), ["a", "b"]);
});

test("empty lines are dropped", () => {
  const s = createLineSplitter();
  assert.deepEqual(s.push(bytes("\n\na\n\r\n\nb\n")), ["a", "b"]);
});

test("end returns a trailing partial line", () => {
  const s = createLineSplitter();
  assert.deepEqual(s.push(bytes("a\nb")), ["a"]);
  assert.deepEqual(s.end(), ["b"]);
  assert.deepEqual(s.end(), []);
});
