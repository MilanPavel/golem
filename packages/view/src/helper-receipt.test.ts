import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyChat, type ChatState, type HelperRef } from "./chat-state.ts";
import { helperBanner, helperReceipt } from "./helper-receipt.ts";

const REF: HelperRef = { id: "h1", index: 0, agent: "explorer", label: "explorer", model: "qwen3:27b", startedAt: "2026-11-10T10:00:00Z", ended: null };
const END = { stopped: "done", modelCalls: 3, tokens: 14_000, answerTokens: 620, costUsd: 0.01, durationMs: 72_000, workingMs: 70_000 };
const ENDED: HelperRef = { ...REF, ended: END };

const TRIMMED: ChatState = {
  ...emptyChat,
  messages: [
    { id: "u", role: "user", text: "Find the refresh.", streaming: false },
    { id: "a", role: "assistant", text: "It is in auth/session.py.", streaming: false },
  ],
};

test("the banner of a running helper says it runs", () => {
  const banner = helperBanner({ lead: "Fix refresh", ref: REF, chat: { ...emptyChat, busy: true } });
  assert.deepEqual(banner, { lead: "Fix refresh", agent: "explorer", model: "qwen3:27b", running: true });
});

test("the banner of a finished helper does not run", () => {
  assert.equal(helperBanner({ lead: null, ref: ENDED, chat: TRIMMED }).running, false);
});

test("before the lead's log arrives the banner uses the listed agent and no model", () => {
  const banner = helperBanner({ lead: "x", ref: undefined, chat: TRIMMED, agent: "docs" });
  assert.deepEqual(banner, { lead: "x", agent: "docs", model: null, running: false });
});

test("the receipt keeps the brief, the outcome, the numbers and the day the steps went", () => {
  const receipt = helperReceipt({ ref: ENDED, chat: TRIMMED, trimmedAt: "2026-11-19T03:00:00Z" });
  assert.equal(receipt.brief, "Find the refresh.");
  assert.equal(receipt.outcome, "Answered");
  assert.deepEqual(receipt.facts, ["qwen3:27b", "14.0K tokens", "$0.01", "1m 10s"]);
  assert.equal(receipt.removed, "Steps removed on 2026-11-19");
  assert.equal(receipt.answerNote, "The answer is in the lead's chat.");
});

test("a helper that hit a limit says so, and an unknown date or lead log leaves lines out", () => {
  const limited = { ...REF, ended: { ...END, stopped: "time" } };
  assert.equal(helperReceipt({ ref: limited, chat: TRIMMED, trimmedAt: null }).outcome, "Stopped: time limit");
  const bare = helperReceipt({ ref: undefined, chat: TRIMMED, trimmedAt: "soon" });
  assert.deepEqual(bare.facts, []);
  assert.equal(bare.removed, null);
});
