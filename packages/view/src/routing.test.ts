import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAmount, parsePercent, pickedLine, toPercent, windowCaption, windowSize } from "./routing.ts";

test("the window caption names what Auto gives for the model on this Mac", () => {
  assert.equal(windowCaption("ollama/qwen3:27b", 32768, 36), "Auto picks 32K for qwen3:27b on this Mac (36 GB).");
  assert.equal(windowCaption("qwen3:8b", 8192, null), "Auto picks 8K for qwen3:8b on this Mac.");
  assert.equal(windowCaption(null, 8192, 16), null);
  assert.equal(windowCaption("qwen3:8b", null, 16), null);
});

test("a window size reads as a person says it", () => {
  assert.equal(windowSize(32768), "32K");
  assert.equal(windowSize(6144), "6K");
  assert.equal(windowSize(40_000), "40K");
  assert.equal(windowSize(41_500), "41.5K");
  assert.equal(windowSize(900), "900");
});

test("an empty tier says what golem picks", () => {
  assert.equal(pickedLine("ollama/qwen3:27b"), "Picked for you: qwen3:27b");
  assert.equal(pickedLine(null), "Picked for you: nothing is ready");
});

test("typed amounts: empty clears, junk is refused", () => {
  assert.deepEqual(parseAmount(""), { ok: true, value: null });
  assert.deepEqual(parseAmount(" $2.50 "), { ok: true, value: 2.5 });
  assert.deepEqual(parseAmount("two"), { ok: false, message: "Enter a number." });
});

test("percents convert to shares and back", () => {
  assert.equal(toPercent(0.7), "70");
  assert.equal(toPercent(0.855), "85.5");
  assert.deepEqual(parsePercent("70"), { ok: true, value: 0.7 });
  assert.deepEqual(parsePercent("85.5%"), { ok: true, value: 0.855 });
  assert.deepEqual(parsePercent("x"), { ok: false, message: "Enter a number." });
});
