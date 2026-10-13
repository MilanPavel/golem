import assert from "node:assert/strict";
import { test } from "node:test";

import { formatWireLine, pushWire, type WireFrame, type WireLine } from "./wire.ts";

function push(lines: readonly WireLine[], frame: WireFrame, limit?: number): WireLine[] {
  return pushWire(lines, frame, limit);
}

test("a run of token fragments becomes one line", () => {
  let lines: WireLine[] = [];
  lines = push(lines, { direction: "in", kind: "message.delta", chars: 4 });
  lines = push(lines, { direction: "in", kind: "message.delta", chars: 1200 });
  lines = push(lines, { direction: "in", kind: "message.completed" });
  lines = push(lines, { direction: "in", kind: "message.delta", chars: 3 });

  assert.equal(lines.length, 3);
  assert.equal(formatWireLine(lines[0]!), "← message.delta ×2, 1204 chars");
  assert.equal(formatWireLine(lines[1]!), "← message.completed");
  assert.equal(formatWireLine(lines[2]!), "← message.delta, 3 chars");
});

test("heartbeat pings group across directions", () => {
  let lines: WireLine[] = [];
  lines = push(lines, { direction: "out", kind: "ping" });
  lines = push(lines, { direction: "in", kind: "ping" });
  lines = push(lines, { direction: "out", kind: "ping" });
  lines = push(lines, { direction: "in", kind: "message.delta", chars: 1 });
  lines = push(lines, { direction: "out", kind: "ping" });

  assert.equal(formatWireLine(lines[0]!), "ping ×3");
  assert.equal(formatWireLine(lines[1]!), "← message.delta, 1 chars");
  assert.equal(formatWireLine(lines[2]!), "→ ping");
});

test("the list drops the oldest lines", () => {
  let lines: WireLine[] = [];
  for (let index = 0; index < 5; index += 1) {
    lines = push(lines, { direction: "out", kind: `call-${index}` }, 3);
  }
  assert.deepEqual(
    lines.map((line) => line.kind),
    ["call-2", "call-3", "call-4"],
  );
});

test("token fragments keep the text that was sent", () => {
  let lines: WireLine[] = [];
  lines = push(lines, { direction: "in", kind: "message.delta", chars: 4, detail: "Zde " });
  lines = push(lines, { direction: "in", kind: "message.delta", chars: 5, detail: "je…" });
  lines = push(lines, {
    direction: "in",
    kind: "message.completed",
    detail: "seq 8  assistant  Zde je jeden vtip",
  });
  lines = push(lines, { direction: "out", kind: "message.send", detail: "tell me a joke" });

  assert.equal(formatWireLine(lines[0]!), "← message.delta ×2  Zde je…");
  assert.equal(formatWireLine(lines[1]!), "← message.completed  seq 8  assistant  Zde je jeden vtip");
  assert.equal(formatWireLine(lines[2]!), "→ message.send  tell me a joke");
});

test("a protocol line shows the json from the socket", () => {
  const completed = '{"jsonrpc":"2.0","method":"event","params":{"type":"message.completed"}}';
  let lines: WireLine[] = [];
  lines = push(lines, {
    direction: "in",
    kind: "message.delta",
    json: '{"method":"event","params":{"type":"message.delta","data":{"text":"He"}}}',
  });
  lines = push(lines, {
    direction: "in",
    kind: "message.delta",
    json: '{"method":"event","params":{"type":"message.delta","data":{"text":"llo"}}}',
  });
  lines = push(lines, { direction: "in", kind: "message.completed", json: completed });
  lines = push(lines, {
    direction: "out",
    kind: "message.send",
    json: '{"jsonrpc":"2.0","method":"message.send","params":{"text":"hello"},"id":3}',
  });

  assert.equal(
    formatWireLine(lines[0]!),
    '← ×2 {"method":"event","params":{"type":"message.delta","data":{"text":"llo"}}}',
  );
  assert.equal(formatWireLine(lines[1]!), `← ${completed}`);
  assert.equal(
    formatWireLine(lines[2]!),
    '→ {"jsonrpc":"2.0","method":"message.send","params":{"text":"hello"},"id":3}',
  );
});

test("commands keep their direction", () => {
  const lines = push([], { direction: "out", kind: "message.send" });
  assert.equal(formatWireLine(lines[0]!), "→ message.send");
});
