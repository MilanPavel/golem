import assert from "node:assert/strict";
import { test } from "node:test";

import { formatRatio, formatShare, reasonTiles, rulesFoot, type DelegateNumbers } from "./agents-rules.ts";

const n = (value: number, def = value) => ({ value, default: def, is_default: value === def });
const DEFAULTS: DelegateNumbers = { read_share: n(0.3), fill_share: n(0.85), job_share: n(0.1), price_ratio: n(3) };
const text = (line: { text: string }[]) => line.map((p) => p.text).join("");

test("numbers read as percent and times", () => {
  assert.equal(formatShare(0.3), "30%");
  assert.equal(formatShare(0.425), "43%");
  assert.equal(formatRatio(3), "3×");
  assert.equal(formatRatio(2.54), "2.5×");
});

test("default numbers give three tiles that say what golem suggests", () => {
  const tiles = reasonTiles(DEFAULTS);
  assert.deepEqual(
    tiles.map((t) => t.title),
    ["It would not fit", "Jobs can run at once", "Another model suits it"],
  );
  assert.equal(text(tiles[0]!.line), "golem suggests a helper when the reading is over 30% of the window, or the window is already 85% full.");
  assert.equal(text(tiles[1]!.line), "golem suggests several when there are two or more separate jobs, each at least 10% of the window.");
  assert.equal(text(tiles[2]!.line), "golem suggests moving a large read to a model 3× cheaper, and one hard question to a stronger model.");
  assert.ok(tiles.every((t) => t.line.every((p) => !p.changed)));
});

test("changed numbers show and are marked", () => {
  const tiles = reasonTiles({ ...DEFAULTS, read_share: n(0.42, 0.3), price_ratio: n(2.5, 3) });
  assert.match(text(tiles[0]!.line), /over 42% of/);
  assert.match(text(tiles[2]!.line), /model 2.5× cheaper/);
  assert.deepEqual(
    tiles[0]!.line.filter((p) => p.changed).map((p) => p.text),
    ["42%"],
  );
  assert.deepEqual(tiles[1]!.line.filter((p) => p.changed), []);
});

test("the foot says first guess, changed, or measured", () => {
  assert.equal(rulesFoot(DEFAULTS).kind, "guess");
  assert.equal(rulesFoot({ ...DEFAULTS, job_share: n(0.12, 0.1) }).kind, "changed");
  assert.deepEqual(rulesFoot(DEFAULTS, { date: "23 Nov", model: "qwen3.8:27b" }), { kind: "measured", tag: "MEASURED", text: "on 23 Nov with qwen3.8:27b." });
});
