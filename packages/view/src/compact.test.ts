import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionCompactResult } from "@golem/client";

import { compactLine, contextShift, loadingLine, windowGrewLine } from "./compact.ts";

const summary: SessionCompactResult = { before_tokens: 6_000, after_tokens: 2_000, count: 9, window: 7_000, model: "qwen3:27b" };

test("a summary says the turns, the model, the context and the time", () => {
  assert.equal(
    compactLine("summarise", { ...summary, before_tokens: 5_880, after_tokens: 2_170 }, 6_200),
    "summarised 9 earlier turns with qwen3:27b · ctx 84% → 31% · 6.2 s",
  );
});

test("a clear says the results and the context, and no time", () => {
  const result = { ...summary, count: 12, before_tokens: 4_970, after_tokens: 2_660, model: null };
  assert.equal(compactLine("clear", result, 40), "cleared 12 old tool results · ctx 71% → 38%");
});

test("one turn is singular, and a long summary shows minutes", () => {
  assert.equal(
    compactLine("summarise", { ...summary, count: 1, model: null }, 75_000),
    "summarised 1 earlier turn · ctx 86% → 29% · 1m 15s",
  );
  assert.equal(compactLine("clear", { ...summary, count: 1 }, 0), "cleared 1 old tool result · ctx 86% → 29%");
});

test("nothing to do says so, whatever the action", () => {
  const none = { ...summary, count: 0, after_tokens: summary.before_tokens };
  assert.equal(compactLine("summarise", none, 10), "nothing to compact yet");
  assert.equal(compactLine("clear", none, 10), "nothing to compact yet");
});

test("an unknown window shows token counts", () => {
  assert.equal(contextShift({ ...summary, window: null }), "ctx 6000 → 2000 tokens");
  assert.equal(contextShift({ before_tokens: 1, after_tokens: 1, count: 1 }), "ctx 1 → 1 tokens");
});

test("a manual grow says the two windows, and that the next turn loads them", () => {
  const grown = { before_tokens: 0, after_tokens: 0, count: 0, window: 61_440, window_from: 32_768, window_to: 65_536 };
  assert.equal(compactLine("grow", grown, 5), "the window will grow 32K → 64K on the next turn");
  assert.equal(compactLine("grow", { ...grown, window_from: null }, 5), "the window will grow on the next turn");
});

test("the chat says the window grew and how long the reload took", () => {
  assert.equal(windowGrewLine(32_768, 65_536, 8_200), "window grew 32K → 64K · reloaded in 8 s");
  assert.equal(windowGrewLine(32_768, 65_536, 400), "window grew 32K → 64K · reloaded in 400 ms");
  assert.equal(windowGrewLine(32_768, 65_536, 75_000), "window grew 32K → 64K · reloaded in 1m 15s");
  assert.equal(windowGrewLine(32_768, 65_536, null), "window grew 32K → 64K");
});

test("the meter says which model loads with which window", () => {
  assert.equal(loadingLine("qwen3:8b", 65_536), "loading qwen3:8b with a 64K window");
});
