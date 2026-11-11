import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatMessage, ToolBlock } from "./chat-state.ts";
import { groupTurns, turnFooter } from "./turns.ts";

const user = (id: string): ChatMessage => ({ id, role: "user", text: "q", streaming: false });
const tool = (callId: string): ToolBlock => ({ callId, name: "grep", args: {}, status: "done" });
const step = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", text: "", streaming: false, ...over });

test("a single answer is one golem turn", () => {
  const turns = groupTurns([user("u"), step("a", { text: "hi", durationMs: 1000 })]);
  assert.deepEqual(turns.map((t) => t.kind), ["user", "golem"]);
});

test("three tool steps and a final answer are one turn, with one footer", () => {
  const steps = [
    step("a1", { tools: [tool("1")], durationMs: 1000 }),
    step("a2", { tools: [tool("2"), tool("3")], durationMs: 2000 }),
    step("a3", { tools: [tool("4")], durationMs: 3000 }),
    step("a4", { text: "done", durationMs: 4000 }),
  ];
  const turns = groupTurns([user("u"), ...steps]);
  assert.equal(turns.length, 2);
  const golem = turns[1];
  assert.ok(golem?.kind === "golem");
  assert.equal(golem.steps.length, 4);
  assert.equal(golem.id, "a1");
  assert.deepEqual(turnFooter(golem.steps), { durationMs: 4000, tools: 4 });
});

test("two user turns are two golem turns", () => {
  const turns = groupTurns([user("u1"), step("a1"), user("u2"), step("a2"), step("a3")]);
  assert.deepEqual(turns.map((t) => t.kind), ["user", "golem", "user", "golem"]);
  assert.equal(turns[3]?.kind === "golem" ? turns[3].steps.length : 0, 2);
});

test("a streaming last step has no footer yet", () => {
  const steps = [step("a1", { tools: [tool("1")], durationMs: 1000 }), step("a2", { streaming: true })];
  assert.equal(turnFooter(steps), null);
});

test("no messages, no turns", () => {
  assert.deepEqual(groupTurns([]), []);
});
