import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTEXT_WORDS, contextRightNow, handoffChips, hostedNote, windowBar, type ContextSpan } from "./context-settings.ts";
import { ROUTING_WORDS, type ContextSettings } from "./routing.ts";

const context: ContextSettings = { reply_reserve: 4096, clear_at: 0.7, clear_to: 0.4, compact_at: 0.85 };
const flat = (paragraphs: ContextSpan[][]) => paragraphs.map((spans) => spans.map((s) => s.text).join(""));
const local = { model: "qwen3:14b", tokens: 32768, kind: "auto" as const };
const hosted = { model: "claude-sonnet-4.5", tokens: 200_000, provider: "anthropic" };

test("the step words are copied from the routing page", () => {
  assert.equal(CONTEXT_WORDS.clearLine, ROUTING_WORDS.long.clearLine);
  assert.equal(CONTEXT_WORDS.keepTurns, ROUTING_WORDS.long.keepTurns);
});

test("the window bar is null without a usable window", () => {
  assert.equal(windowBar(context, null), null);
  assert.equal(windowBar(context, 0), null);
  assert.equal(windowBar(context, -5), null);
  assert.equal(windowBar(context, 4096), null);
  assert.equal(windowBar(context, 1000), null);
});

test("the window bar follows the room, not the whole window", () => {
  const bar = windowBar(context, 32768);
  assert.ok(bar);
  assert.equal(bar.room, 28672);
  assert.deepEqual(bar.zones.map((z) => z.kind), ["work", "clear", "summarise", "reply"]);
  assert.ok(Math.abs(bar.zones[0]!.to - 61.25) < 1e-9);
  assert.ok(Math.abs(bar.marks.clear.at - 61.25) < 1e-9);
  assert.equal(bar.marks.clear.label, "70%");
  assert.equal(bar.marks.summarise.label, "85%");
});

test("the window bar zones add up to 100 with no gaps", () => {
  const zones = windowBar(context, 32768)!.zones;
  assert.equal(zones[0]!.from, 0);
  assert.equal(zones[3]!.to, 100);
  zones.slice(1).forEach((zone, i) => assert.equal(zone.from, zones[i]!.to));
  const total = zones.reduce((sum, z) => sum + (z.to - z.from), 0);
  assert.ok(Math.abs(total - 100) < 1e-9);
});

test("right now says it all for auto and a hosted model", () => {
  const [first, second] = flat(contextRightNow({ context, mode: "auto", local, hosted }));
  assert.equal(
    first,
    "qwen3:14b gets a 32K window; claude-sonnet-4.5 has 200K, set by Anthropic. On any model, 4K stays free for the reply. At 70% full golem clears old tool results, and at 85% it summarises earlier turns.",
  );
  assert.equal(
    second,
    "Nothing is deleted. The whole chat stays in the transcript. Only what the model is sent gets shorter. When a local chat still does not fit, the routing path steps up to a hosted model.",
  );
});

test("right now marks the names as code and the percentages with their tones", () => {
  const [first] = contextRightNow({ context, mode: "auto", local, hosted });
  assert.deepEqual(first!.filter((s) => s.kind === "chip").map((s) => s.text), ["qwen3:14b", "32K", "claude-sonnet-4.5", "200K", "4K"]);
  assert.equal(first!.find((s) => s.kind === "wait")?.text, "70%");
  assert.equal(first!.find((s) => s.kind === "summary")?.text, "85%");
});

test("right now leaves out the hosted clause", () => {
  const [first] = flat(contextRightNow({ context, mode: "auto", local, hosted: null }));
  assert.ok(first!.startsWith("qwen3:14b gets a 32K window. On any model, 4K"));
});

test("right now starts with On any model without a local model", () => {
  const [first] = flat(contextRightNow({ context, mode: "auto", local: null, hosted }));
  assert.ok(first!.startsWith("On any model, 4K stays free"));
});

test("right now says when the window is not known", () => {
  const [first] = flat(contextRightNow({ context, mode: "auto", local: { ...local, tokens: null }, hosted: null }));
  assert.ok(first!.startsWith("qwen3:14b's window is not known yet. On any model"));
});

test("right now says Ollama picks the window", () => {
  const [first] = flat(contextRightNow({ context, mode: "auto", local: { ...local, tokens: null, kind: "ollama" }, hosted }));
  assert.ok(first!.startsWith("Ollama picks the window for qwen3:14b; claude-sonnet-4.5 has 200K, set by Anthropic."));
});

test("right now stops with a message in local mode", () => {
  const [, second] = flat(contextRightNow({ context, mode: "local", local, hosted: null }));
  assert.ok(second!.endsWith("When a chat still does not fit, it stops with a message."));
});

test("the hosted note says step 1 rarely runs on a big window", () => {
  assert.equal(hostedNote("anthropic", 200_000, context), "Window set by Anthropic. Step 1 starts at about 140K, so it rarely runs.");
});

test("the hosted note leaves that out below 64K", () => {
  assert.equal(hostedNote("anthropic", 32768, context), "Window set by Anthropic. Step 1 starts at about 20K.");
});

test("the handoff chips list the window and the two steps", () => {
  assert.deepEqual(handoffChips(context, 32768), ["32K window · auto", "clear at 70%", "summarise at 85%"]);
  assert.equal(handoffChips(context, 16384, "fixed")[0], "16K window · fixed");
  assert.equal(handoffChips(context, null, "ollama")[0], "Ollama's window");
  assert.equal(handoffChips(context, null)[0], "window · auto");
});
