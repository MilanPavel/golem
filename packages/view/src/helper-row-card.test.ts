import assert from "node:assert/strict";
import { test } from "node:test";

import { helperRowCard, type HelperCardSession } from "./helper-row-card.ts";
import { groupHelpers } from "./helper-rows.ts";

const NOW = Date.parse("2026-11-20T12:10:00Z");

function h(id: string, status: string, extra: Partial<HelperCardSession> = {}): HelperCardSession {
  return {
    session_id: id,
    status,
    parent_session_id: "lead",
    agent: "explorer",
    title: `explorer · ${id} brief`,
    created_at: "2026-11-20T12:09:00Z",
    ...extra,
  };
}

test("two working, one asking, one queued: head and blocks in order", () => {
  const card = helperRowCard(
    [
      h("a", "running", { step: "read daemon/app.py" }),
      h("b", "running", { step: "  " }),
      h("c", "waiting", {
        pending: { kind: "approval", since: "2026-11-20T12:09:30Z", call_id: "c1", name: "shell", subject: "rm -rf build" },
      }),
      h("d", "running", { wait_reason: "slot", wait_line: "qwen3:14b" }),
    ],
    NOW,
  );
  assert.ok(card);
  assert.equal(card.head, "4 helpers · 1 asks you");
  assert.deepEqual(card.blocks.map((b) => b.square), ["working", "working", "asking", "queued"]);
  assert.equal(card.blocks[0]?.agent, "explorer");
  assert.equal(card.blocks[0]?.title, "a brief");
  assert.equal(card.blocks[0]?.working, "1m 00s");
  assert.equal(card.blocks[0]?.step, "read daemon/app.py");
  assert.equal(card.blocks[1]?.step, null);
  assert.deepEqual(card.blocks[2]?.asks, { text: "Run rm -rf build", callId: "c1" });
  assert.ok(card.blocks[3]?.waiting);
  assert.equal(card.blocks[3]?.asks, null);
});

test("a consent question has no call to answer from the card", () => {
  const card = helperRowCard([h("c", "waiting", { pending: { kind: "consent", since: "2026-11-20T12:09:30Z" } })], NOW);
  assert.equal(card?.blocks[0]?.asks?.callId, null);
  assert.equal(card?.head, "1 helper · 1 asks you");
});

test("two asking say 'ask you'", () => {
  assert.equal(helperRowCard([h("a", "waiting"), h("b", "waiting")], NOW)?.head, "2 helpers · 2 ask you");
});

test("helpers that are done leave no card", () => {
  assert.equal(helperRowCard([h("a", "idle"), h("b", "closed")], NOW), null);
  assert.equal(helperRowCard([], NOW), null);
});

test("an older daemon: no agent, no title, no step, no start", () => {
  const card = helperRowCard([{ session_id: "x", status: "running" }], NOW);
  assert.deepEqual(card?.blocks[0], {
    sessionId: "x",
    square: "working",
    agent: "helper",
    title: "",
    working: null,
    waiting: null,
    step: null,
    asks: null,
  });
});

test("groupHelpers gives each lead its helper summaries in order", () => {
  const list = [{ session_id: "lead", status: "running" }, h("a", "running"), h("z", "idle"), h("b", "running")];
  const { helpers } = groupHelpers(list);
  assert.deepEqual(helpers.get("lead")?.map((s) => s.session_id), ["a", "b"]);
});
