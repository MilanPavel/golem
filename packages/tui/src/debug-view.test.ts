import assert from "node:assert/strict";
import { test } from "node:test";

import type { WireLine } from "@golem/client";

import { closedDebug, type DebugState } from "./commands.ts";
import { historyNote, holdDebugOffset, layoutDebug } from "./debug-view.ts";

function wireLine(kind: string, detail: string, count = 1, json = ""): WireLine {
  return { direction: "in", kind, count, chars: detail.length, detail, json };
}

function textOf(rows: { spans: { text: string }[] }[]): string {
  return rows.map((row) => row.spans.map((span) => span.text).join("")).join("\n");
}

const openWire: DebugState = { ...closedDebug, open: true, tab: "wire" };

test("the protocol tab shows payloads and keeps heartbeats out of the list", () => {
  const wire = [
    ...Array.from({ length: 10 }, (_, index) => wireLine("message.completed", `seq ${index}  assistant  line ${index}`)),
    wireLine("ping", "", 472),
  ];
  const rows = layoutDebug({
    debug: openWire,
    rows: 4,
    columns: 80,
    wire,
    messages: [],
    screenCount: 0,
    modelCount: null,
  });
  const text = textOf(rows.rows);
  assert.match(text, /ping ×472/);
  assert.match(text, /message\.completed  seq 9  assistant  line 9/);
  assert.match(text, /tab/);
  assert.match(text, /esc/);
  assert.doesNotMatch(text, /line 0/);
  const body = text.split("\n").slice(1).join("\n");
  assert.doesNotMatch(body, /ping/);
});

test("the model tab shows the checkpoint and a held line", () => {
  const rows = layoutDebug({
    debug: { open: true, tab: "model", hold: true, held: "next question" },
    rows: 6,
    columns: 40,
    wire: [wireLine("message.delta", "hello", 2)],
    messages: [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
    ],
    screenCount: 2,
    modelCount: 2,
  });
  const text = textOf(rows.rows);
  assert.match(text, /user {2}hello/);
  assert.match(text, /assistant {2}hi there/);
  assert.match(text, /pending {2}next question/);
  assert.doesNotMatch(text, /message\.delta/);
  assert.equal(historyNote(2, 2), null);
});

test("a count mismatch is one line", () => {
  assert.equal(historyNote(2, 4), "screen 2 · model 4");
  assert.equal(historyNote(0, null), null);
  const rows = layoutDebug({
    debug: { open: true, tab: "model", hold: false, held: null },
    rows: 4,
    columns: 40,
    wire: [],
    messages: [{ role: "user", text: "only in the checkpoint" }],
    screenCount: 0,
    modelCount: 1,
  });
  assert.equal(rows.rows.at(-1)?.spans[0]?.text, "screen 0 · model 1");
  assert.equal(rows.rows.at(-1)?.spans[0]?.tone, "note");
});

test("a long protocol line wraps, and the offset moves inside it", () => {
  const payload = `{"method":"${"abcdef".repeat(40)}"}`;
  const shared = {
    debug: openWire,
    rows: 4,
    columns: 40,
    wire: [wireLine("event", "", 1, payload)],
    messages: [],
    screenCount: 0,
    modelCount: null,
  };
  const tail = layoutDebug(shared);
  const tailText = textOf(tail.rows);
  assert.equal(tailText.includes("…"), false);
  assert.match(tailText, /abcdef/);
  assert.equal(tail.offsetFromBottom, 0);
  assert.doesNotMatch(tailText, /method/);
  const head = layoutDebug({ ...shared, offsetFromBottom: 100 });
  assert.match(textOf(head.rows), /method/);
  assert.ok(head.offsetFromBottom > 0);
  assert.match(textOf(head.rows), /↑/);
});

test("a scrolled panel stays on the same lines when more arrive", () => {
  assert.equal(holdDebugOffset(0, 10, 14), 0);
  assert.equal(holdDebugOffset(4, 10, 14), 8);
  assert.equal(holdDebugOffset(4, 0, 14), 4);
});
