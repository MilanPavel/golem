import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_FOOTER, isFooterPart, turnFooterLine, type FooterSource } from "./footer.ts";

const LOCAL: FooterSource = { durationMs: 72_000, tools: 5, model: "qwen3:27b", tier: "local", tokens: 38_400, costUsd: 0, helpers: 1 };

test("with every part on and nothing trimmed, the line is today's line", () => {
  assert.deepEqual(turnFooterLine(LOCAL, { off: [], leaveOutEmpty: false }), ["1m 12s", "5 steps", "qwen3:27b", "local", "38.4K tok", "$0.00", "1 helper"]);
});

test("a part that is off is gone", () => {
  assert.deepEqual(turnFooterLine(LOCAL, { off: ["tokens", "time"], leaveOutEmpty: false }), ["5 steps", "qwen3:27b", "local", "$0.00", "1 helper"]);
});

test("leaving out what says nothing drops $0.00, and steps in Quiet", () => {
  assert.deepEqual(turnFooterLine(LOCAL, DEFAULT_FOOTER), ["1m 12s", "5 steps", "qwen3:27b", "local", "38.4K tok", "1 helper"]);
  assert.deepEqual(turnFooterLine(LOCAL, DEFAULT_FOOTER, { detail: "quiet" }), ["1m 12s", "qwen3:27b", "local", "38.4K tok", "1 helper"]);
  assert.ok(turnFooterLine(LOCAL, { off: [], leaveOutEmpty: false }, { detail: "quiet" }).includes("5 steps"));
});

test("a cost above zero stays, and no helpers is no part", () => {
  const paid: FooterSource = { ...LOCAL, tier: "budget", costUsd: 0.31, helpers: 0 };
  assert.deepEqual(turnFooterLine(paid, DEFAULT_FOOTER), ["1m 12s", "5 steps", "qwen3:27b", "38.4K tok", "$0.31"]);
});

test("the routed note goes with the model", () => {
  assert.deepEqual(turnFooterLine(LOCAL, { off: ["model"], leaveOutEmpty: true }, { routedNote: "up" }).slice(0, 2), ["1m 12s", "5 steps"]);
  assert.equal(turnFooterLine(LOCAL, DEFAULT_FOOTER, { routedNote: "up", modelPrefix: "↑ " })[2], "up");
});

test("isFooterPart accepts the seven names", () => {
  assert.ok(isFooterPart("where"));
  assert.ok(!isFooterPart("stronger"));
});
