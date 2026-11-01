import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { MAX_MESSAGE_BYTES, NOT_ALLOWED_FROM_BROWSER, filterMessage } from "./core.ts";

const refused = (reason: string) => ({ kind: "refuse", reason });
const padded = (bytes: number) => `{"method":"ping","x":"${"a".repeat(bytes - 24)}"}`;
const deny = (id: string | number | null) =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32020, message: "not allowed from the browser" } });

test("the daemon's MAX_LINE_BYTES is still the value the limit was derived from", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const py = readFileSync(path.join(here, "../../daemon/golem/server/framing.py"), "utf8");
  const match = /^MAX_LINE_BYTES\s*=\s*([\d_]+)\s*$/m.exec(py);
  assert.equal(Number((match?.[1] ?? "").replaceAll("_", "")), 1_048_576);
  assert.equal(MAX_MESSAGE_BYTES, 1_048_576);
  assert.equal(NOT_ALLOWED_FROM_BROWSER, -32020);
});

test("an allowed method is forwarded as the exact original text plus one newline", () => {
  const text = '  {"id" : 7 ,\t"params":{"b":1,"a":[1,  2]},  "method":"ping"}  ';
  assert.deepEqual(filterMessage(text), { kind: "forward", line: `${text}\n` });
});

test("two objects joined by \\n are refused", () => {
  assert.deepEqual(filterMessage('{"method":"ping"}\n{"method":"auth.set"}'), refused("line-break"));
});

test("\\r\\n is refused", () => {
  assert.deepEqual(filterMessage('{"method":"ping"}\r\n'), refused("line-break"));
});

test("a lone \\r is refused", () => {
  assert.deepEqual(filterMessage('{"method":"ping"}\r{"method":"auth.set"}'), refused("line-break"));
});

test("1 MiB: the largest message passes", () => {
  const text = padded(MAX_MESSAGE_BYTES);
  assert.equal(new TextEncoder().encode(text).byteLength, MAX_MESSAGE_BYTES);
  assert.equal(filterMessage(text).kind, "forward");
});

test("1 MiB plus one byte is refused", () => {
  assert.deepEqual(filterMessage(padded(MAX_MESSAGE_BYTES + 1)), refused("too-large"));
});

test("size counts UTF-8 bytes, not string length", () => {
  const text = `{"method":"ping","x":"${"ž".repeat(Math.ceil(MAX_MESSAGE_BYTES / 2))}"}`;
  assert.ok(text.length < MAX_MESSAGE_BYTES);
  assert.ok(new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES);
  assert.deepEqual(filterMessage(text), refused("too-large"));
});

test("a binary message (ArrayBuffer) is refused", () => {
  const bytes = new TextEncoder().encode('{"method":"ping"}');
  assert.deepEqual(filterMessage(bytes.buffer as ArrayBuffer), refused("binary"));
});

test("a binary message (Uint8Array) is refused", () => {
  assert.deepEqual(filterMessage(new TextEncoder().encode('{"method":"ping"}')), refused("binary"));
});

for (const [name, text] of [
  ["not JSON", "ping"],
  ["empty text", ""],
  ["NaN", '{"method":"ping","x":NaN}'],
  ["Infinity", '{"method":"ping","x":Infinity}'],
] as const) {
  test(`${name} is refused`, () => {
    assert.deepEqual(filterMessage(text), refused("not-json"));
  });
}

for (const [name, text] of [
  ["an array", '[{"method":"ping"}]'],
  ["null", "null"],
  ["a number", "5"],
  ["a string", '"ping"'],
  ["a boolean", "true"],
] as const) {
  test(`${name} is refused as not an object`, () => {
    assert.deepEqual(filterMessage(text), refused("not-object"));
  });
}

test("{} has no method", () => {
  assert.deepEqual(filterMessage("{}"), refused("no-method"));
});

test('{"method": 5} has no method', () => {
  assert.deepEqual(filterMessage('{"method":5}'), refused("no-method"));
});

test("a __proto__ key does not supply a method", () => {
  assert.deepEqual(filterMessage('{"__proto__":{"method":"ping"}}'), refused("no-method"));
});

test("a duplicate method key: JSON.parse and the daemon's Python json both keep the last, so auth.set is denied", () => {
  assert.deepEqual(filterMessage('{"id":1,"method":"ping","method":"auth.set"}'), { kind: "deny", reply: deny(1) });
});

test('"auth.set" written with escapes is denied', () => {
  assert.deepEqual(filterMessage('{"id":2,"method":"auth\\u002eset"}'), { kind: "deny", reply: deny(2) });
});

for (const method of ["auth.set", "auth.remove"]) {
  test(`${method} with a number id gets a reply with that id`, () => {
    assert.deepEqual(filterMessage(`{"jsonrpc":"2.0","id":42,"method":"${method}"}`), { kind: "deny", reply: deny(42) });
  });
  test(`${method} with a string id gets a reply with that id`, () => {
    assert.deepEqual(filterMessage(`{"id":"abc","method":"${method}"}`), { kind: "deny", reply: deny("abc") });
  });
  test(`${method} with a null id gets a reply with a null id`, () => {
    assert.deepEqual(filterMessage(`{"id":null,"method":"${method}"}`), { kind: "deny", reply: deny(null) });
  });
}

test("a denied notification gets no reply", () => {
  assert.deepEqual(filterMessage('{"method":"auth.set","params":{}}'), { kind: "deny", reply: null });
});

test("a denied request with an object id gets no reply", () => {
  assert.deepEqual(filterMessage('{"id":{"a":1},"method":"auth.set"}'), { kind: "deny", reply: null });
});

test("an unknown method is denied", () => {
  assert.deepEqual(filterMessage('{"id":9,"method":"daemon.explode"}'), { kind: "deny", reply: deny(9) });
});

test("the reply has no trailing newline", () => {
  const result = filterMessage('{"id":1,"method":"auth.set"}');
  assert.equal(result.kind === "deny" && result.reply?.endsWith("\n"), false);
});
