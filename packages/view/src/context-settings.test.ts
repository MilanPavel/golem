import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTEXT_WORDS, NO_LOCAL_WINDOW, contextRightNow, handoffChips, hostedNote, localWindow, localWindowLine, windowBar, type ContextSpan, type LocalWindow, type LocalWindowInput } from "./context-settings.ts";
import { type ContextSettings } from "./routing.ts";

const context: ContextSettings = { reply_reserve: 4096, clear_at: 0.7, clear_to: 0.4, compact_at: 0.85 };
const flat = (paragraphs: ContextSpan[][]) => paragraphs.map((spans) => spans.map((s) => s.text).join(""));
const local = { model: "qwen3:14b", kind: "auto" as const, tokens: 32768, source: "golem" as const, estimated: false, reason: null };
const none = { tokens: null, source: null, estimated: false, reason: null };
const hosted = { model: "claude-sonnet-4.5", tokens: 200_000, provider: "anthropic" };

test("the step words are the ones the long-chat part of Routing used to hold", () => {
  assert.match(CONTEXT_WORDS.clearLine, /^A tool result is what a tool gave back/);
  assert.equal(CONTEXT_WORDS.keepTurns, "Newest turns kept word for word");
  assert.equal(CONTEXT_WORDS.nothingDeleted, "Nothing is deleted.");
});

test("the window bar is null without a usable window", () => {
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
    "qwen3:14b gets a 32K window (planned by golem for this Mac); claude-sonnet-4.5 has 200K, set by Anthropic. On any model, 4K stays free for the reply. At 70% full golem clears old tool results, and at 85% it summarises earlier turns.",
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
  assert.ok(first!.startsWith("qwen3:14b gets a 32K window (planned by golem for this Mac). On any model, 4K"));
});

test("right now starts with On any model without a local model", () => {
  const [first] = flat(contextRightNow({ context, mode: "auto", local: null, hosted }));
  assert.ok(first!.startsWith("On any model, 4K stays free"));
});

test("right now says when the window is not known", () => {
  const [first] = flat(contextRightNow({ context, mode: "auto", local: { ...local, ...none }, hosted: null }));
  assert.ok(first!.startsWith("qwen3:14b's window is not known yet. On any model"));
});

test("right now says Ollama picks the window", () => {
  const [first] = flat(contextRightNow({ context, mode: "auto", local: { ...local, ...none, kind: "ollama" }, hosted }));
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
  const w = (tokens: number | null, estimated = false): LocalWindow => ({ ...none, tokens, estimated });
  assert.deepEqual(handoffChips(context, w(32768)), ["32K window · auto", "clear at 70%", "summarise at 85%"]);
  assert.equal(handoffChips(context, w(16384), "fixed")[0], "16K window · fixed");
  assert.equal(handoffChips(context, w(8192, true), "auto")[0], "≈ 8K window · auto");
  assert.equal(handoffChips(context, w(8192, true), "ollama")[0], "≈ 8K window · ollama");
  assert.equal(handoffChips(context, NO_LOCAL_WINDOW, "ollama")[0], "Ollama's window");
  assert.equal(handoffChips(context, NO_LOCAL_WINDOW)[0], "window · auto");
});

const base: LocalWindowInput = { setting: "auto", options: null, maxCtx: null, size_gb: 5, fit: "fits" };
const opts = (from: string | undefined, num: number | undefined, saved: Record<string, unknown> = {}) => ({
  saved,
  defaults: num === undefined ? {} : { num_ctx: num },
  from,
});

test("the window follows the daemon's order, one source each", () => {
  assert.deepEqual(localWindow({ ...base, options: opts("golem", 32768, { num_ctx: 8192 }) }), { tokens: 8192, source: "saved", estimated: false, reason: null });
  assert.deepEqual(localWindow({ ...base, setting: 16384, options: opts("golem", 32768) }), { tokens: 16384, source: "fixed", estimated: false, reason: null });
  assert.deepEqual(localWindow({ ...base, options: opts("golem", 32768) }), { tokens: 32768, source: "golem", estimated: false, reason: null });
  assert.deepEqual(localWindow({ ...base, options: opts("modelfile", 8192) }), { tokens: 8192, source: "modelfile", estimated: true, reason: "golem could not plan one" });
  assert.deepEqual(localWindow({ ...base, options: opts("ollama", 4096) }), { tokens: 4096, source: "ollama", estimated: true, reason: "golem could not plan one" });
});

test("a saved window beats a fixed one, and a fixed one is cut to the model's maximum", () => {
  assert.equal(localWindow({ ...base, setting: 16384, options: opts(undefined, undefined, { num_ctx: 4096 }) }).source, "saved");
  assert.equal(localWindow({ ...base, setting: 262144, maxCtx: 40960, options: null }).tokens, 40960);
  assert.equal(localWindow({ ...base, setting: 8192, maxCtx: 40960, options: null }).tokens, 8192);
});

test("with Ollama's window the plan is skipped", () => {
  assert.deepEqual(localWindow({ ...base, setting: "ollama", options: opts("golem", 32768) }), NO_LOCAL_WINDOW);
  assert.deepEqual(localWindow({ ...base, setting: "ollama", options: opts("ollama", 4096) }), { tokens: 4096, source: "ollama", estimated: true, reason: null });
});

test("each reason golem has no plan on Auto", () => {
  assert.equal(localWindow({ ...base, size_gb: null, options: opts(undefined, undefined) }).reason, "Ollama has not reported this model's size yet");
  assert.equal(localWindow({ ...base, fit: "too_big", options: opts(undefined, undefined) }).reason, "it is too big for this Mac's memory");
  assert.equal(localWindow({ ...base, options: opts(undefined, undefined) }).reason, "golem could not plan one");
  assert.equal(localWindow({ ...base, options: null }).tokens, null);
});

test("each source and its words, with ≈ on the forecasts", () => {
  const line = (source: LocalWindow["source"], tokens: number, estimated = false) => localWindowLine({ tokens, source, estimated, reason: null });
  assert.equal(line("golem", 32768), "32K · planned by golem for this Mac");
  assert.equal(line("saved", 8192), "8K · set for this model");
  assert.equal(line("ollama", 8192, true), "≈ 8K · Ollama's default");
  assert.equal(line("modelfile", 8192, true), "≈ 8K · from the model's Modelfile");
  assert.equal(line("fixed", 8192), null);
  assert.equal(localWindowLine(NO_LOCAL_WINDOW), null);
});

test("right now shows the ≈ and the source, and the reason when there is no window", () => {
  const [a] = flat(contextRightNow({ context, mode: "auto", local: { ...local, tokens: 8192, source: "modelfile", estimated: true }, hosted: null }));
  assert.ok(a!.startsWith("qwen3:14b gets a ≈ 8K window (from the model's Modelfile). On any model"));
  const [b] = flat(contextRightNow({ context, mode: "auto", local: { ...local, ...none, reason: "it is too big for this Mac's memory" }, hosted: null }));
  assert.ok(b!.startsWith("qwen3:14b's window is not known yet (it is too big for this Mac's memory). On any model"));
});

test("the bar with no window is four shares with a narrow reply, and the words of the switch and the rules", () => {
  const bar = windowBar(context, null)!;
  assert.deepEqual(bar.zones.map((z) => z.kind), ["work", "clear", "summarise", "reply"]);
  assert.equal(bar.zones[3]!.to - bar.zones[3]!.from, 8);
  assert.ok(Math.abs(bar.zones[1]!.from - 0.7 * 92) < 1e-9);
  assert.equal(bar.marks.clear.label, "70%");
  assert.equal(bar.marks.summarise.label, "85%");
  assert.equal(CONTEXT_WORDS.fill.showOn, "Example:");
  assert.match(CONTEXT_WORDS.rules, /^This page holds the rules for every chat\. A chat's live fill is the `ctx` chip in the chat\.$/);
});
