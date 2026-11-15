import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionCompactResult } from "@golem/client";

import { compactWaiting, runCompact } from "./compact.ts";

function fake(result: SessionCompactResult) {
  const calls: unknown[][] = [];
  return {
    calls,
    client: {
      compactSession: async (...args: unknown[]) => {
        calls.push(args);
        return result;
      },
    },
  };
}

test("/compact calls the client with the focus and prints the line", async () => {
  const { calls, client } = fake({ before_tokens: 5880, after_tokens: 2170, count: 9, window: 7000, model: "qwen3:27b" });
  const times = [1_000, 7_200];
  const line = await runCompact(client, "s_1", "summarise", "the plan", () => times.shift() ?? 0);
  assert.deepEqual(calls, [["s_1", "summarise", "the plan"]]);
  assert.equal(line, "summarised 9 earlier turns with qwen3:27b · ctx 84% → 31% · 6.2 s");
});

test("/context clear calls the client without a focus", async () => {
  const { calls, client } = fake({ before_tokens: 4970, after_tokens: 2660, count: 12, window: 7000 });
  const line = await runCompact(client, "s_1", "clear", null);
  assert.deepEqual(calls, [["s_1", "clear", undefined]]);
  assert.equal(line, "cleared 12 old tool results · ctx 71% → 38%");
});

test("a count of 0 says there is nothing to compact", async () => {
  const { client } = fake({ before_tokens: 10, after_tokens: 10, count: 0 });
  assert.equal(await runCompact(client, "s_1", "summarise", null), "nothing to compact yet");
});

test("the waiting line differs for a summary", () => {
  assert.notEqual(compactWaiting("summarise"), compactWaiting("clear"));
});
