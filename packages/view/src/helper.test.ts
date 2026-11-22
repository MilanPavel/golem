import assert from "node:assert/strict";
import { test } from "node:test";

import type { HelperRun, ToolBlock } from "./chat-state.ts";
import { turnFooterParts, turnTotals } from "./cost.ts";
import { helperHead, helperLine, helperStop, helperStopWords, helperToolCounts, helperTreeRows } from "./helper.ts";

function step(callId: string, name: string, args: Record<string, unknown>, status: ToolBlock["status"] = "done"): ToolBlock {
  return { callId, name, args, status };
}

function helper(over: Partial<HelperRun> = {}): HelperRun {
  return {
    helpers: [],
    model: "qwen3:27b",
    modelCalls: 3,
    toolSteps: [],
    tokens: 5000,
    costUsd: 0,
    status: "done",
    answerTokens: 620,
    startedAt: null,
    durationMs: 72_000,
    ...over,
  };
}

function reads(count: number): ToolBlock[] {
  return Array.from({ length: count }, (_, at) => step(`r${String(at)}`, "read_file", { path: `f${String(at)}.py` }));
}

function delegate(status: ToolBlock["status"], child: HelperRun | undefined, args: Record<string, unknown> = { brief: "look" }): ToolBlock {
  return { callId: "d1", name: "delegate", args, status, ...(child === undefined ? {} : { child }) };
}

test("a finished helper reads as one line with its counts, time and answer", () => {
  const done = delegate("done", helper({ toolSteps: reads(14) }));
  assert.equal(helperLine(done), "explorer · qwen3:27b · read 14 files · 1m 12s · returned 620 tokens");
});

test("calls are counted by kind, with one in the singular", () => {
  const steps = [...reads(1), step("g1", "grep", { pattern: "x" }), step("g2", "glob", { pattern: "*" }), step("g3", "grep", { pattern: "y" }), step("l", "list_dir", { path: "." })];
  const line = helperLine(delegate("done", helper({ toolSteps: steps })));
  assert.equal(line, "explorer · qwen3:27b · read 1 file, 3 searches, listed 1 folder · 1m 12s · returned 620 tokens");
  assert.equal(helperLine(delegate("done", helper({ toolSteps: [step("g", "grep", {})] }))).includes("1 search ·"), true);
});

test("a running helper says what it reads now", () => {
  const steps = [...reads(2), step("k", "read_file", { path: "src/router.py" }, "running")];
  assert.equal(helperLine(delegate("running", helper({ toolSteps: steps, status: "running" }))), "explorer · qwen3:27b · reading src/router.py…");
  const search = [step("k", "grep", { pattern: "route" }, "requested")];
  assert.equal(helperLine(delegate("running", helper({ toolSteps: search }))), "explorer · qwen3:27b · searching route…");
});

test("a helper that has done nothing yet, or has failed, still reads as a line", () => {
  assert.equal(helperLine(delegate("running", undefined)), "explorer · starting…");
  assert.equal(helperLine(delegate("running", undefined, { brief: "x", agent: "scout" })), "scout · starting…");
  assert.equal(helperLine(delegate("failed", helper())), "explorer · qwen3:27b · failed");
});

test("a done line leaves out what is not known", () => {
  const line = helperLine(delegate("done", helper({ answerTokens: null, durationMs: null, model: null })));
  assert.equal(line, "explorer");
});

test("the terminal tree has a head, the calls by tool name, and what came back", () => {
  const steps = [...reads(14), step("g1", "grep", {}), step("g2", "grep", {}), step("g3", "grep", {})];
  const done = delegate("done", helper({ toolSteps: steps }));
  assert.equal(helperHead(done), "delegate · explorer · qwen3:27b · 1m 12s · $0.00");
  assert.equal(helperToolCounts(steps), "read_file ×14 · grep ×3");
  assert.deepEqual(helperTreeRows(done), ["read_file ×14 · grep ×3", "↳ returned 620 tokens"]);
  const running = delegate("running", helper({ toolSteps: [step("k", "read_file", { path: "a.py" }, "running")], status: "running" }));
  assert.equal(helperHead(running), "delegate · explorer · qwen3:27b · $0.00");
  assert.deepEqual(helperTreeRows(running), ["read_file ×1", "↳ reading a.py…"]);
});

test("the turn's totals include the helper, and the footer counts it", () => {
  const message = {
    id: "a",
    role: "assistant" as const,
    text: "",
    streaming: false,
    call: { model: "m", tier: "local" as const, tokens: 100, costUsd: 0.1, done: true },
    tools: [delegate("done", helper({ tokens: 900, costUsd: 0.2 }))],
  };
  const totals = turnTotals([message]);
  assert.equal(totals.tokens, 1000);
  assert.ok(Math.abs((totals.costUsd ?? 0) - 0.3) < 1e-9);
  assert.equal(totals.helpers, 1);
  assert.deepEqual(turnFooterParts(totals).slice(-1), ["1 helper"]);
  assert.deepEqual(turnFooterParts({ ...totals, helpers: 2 }).slice(-1), ["2 helpers"]);
  assert.equal(turnTotals([{ ...message, tools: [] }]).helpers, undefined);
});

test("helperStopWords: a helper that is done says nothing", () => {
  assert.equal(helperStopWords("done"), "");
});

test("helperStopWords: each limit has words", () => {
  assert.equal(helperStopWords("calls"), "stopped: call limit");
  assert.equal(helperStopWords("time"), "stopped: time limit");
  assert.equal(helperStopWords("cost"), "stopped: cost limit");
  assert.equal(helperStopWords("failed"), "stopped: a model call failed");
  assert.equal(helperStopWords("budget"), "stopped: budget spent");
  assert.equal(helperStopWords("tokens"), "stopped: token limit");
  assert.equal(helperStopWords("cancelled"), "stopped: cancelled");
  assert.equal(helperStopWords("later"), "stopped: later");
});

test("helperStop: reads the first line of a result", () => {
  assert.equal(helperStop("explorer finished: budget\n\nwhat I know"), "budget");
  assert.equal(helperStop("the answer"), "done");
});
