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

test("default numbers give three blocks with a When line, a Then line and a note", () => {
  const tiles = reasonTiles(DEFAULTS);
  assert.deepEqual(
    tiles.map((t) => t.title),
    ["Too much to read", "Jobs that do not depend on each other", "Another model fits better"],
  );
  assert.equal(text(tiles[0]!.when), "A job needs to read more than 30% of the context window, or the window is already 85% full.");
  assert.equal(text(tiles[1]!.when), "There are two or more separate jobs, and each needs at least 10% of the window.");
  assert.equal(text(tiles[2]!.when), "A large read can go to a model at least 3× cheaper. One hard question can go to a stronger model.");
  assert.deepEqual(
    tiles.map((t) => t.then),
    ["A helper reads it in its own window and brings back the answer.", "One helper per job, all at once.", "The helper runs on that model."],
  );
  assert.deepEqual(
    tiles.map((t) => t.note),
    ["Any model. The \"already full\" share is checked during the chat.", "Cloud models. Local helpers take turns.", "Needs a second model that is ready"],
  );
  assert.ok(tiles.every((t) => t.when.every((p) => !p.changed && p.tag === undefined)));
});

test("the bars picture the numbers", () => {
  const [fit, parallel, model] = reasonTiles(DEFAULTS);
  assert.deepEqual(fit!.bars, [
    { label: "one read", parts: [0.3] },
    { label: "window full", parts: [0.85] },
  ]);
  assert.deepEqual(parallel!.bars, [{ label: "two jobs", parts: [0.1, 0.1] }]);
  assert.deepEqual(model!.bars.map((b) => b.label), ["this model", "cheaper model"]);
  assert.equal(model!.bars[0]!.parts[0], 1);
  assert.ok(Math.abs(model!.bars[1]!.parts[0]! - 1 / 3) < 1e-9);
  // A number out of range never leaves the bar.
  assert.deepEqual(reasonTiles({ ...DEFAULTS, read_share: n(1.4, 0.3) })[0]!.bars[0]!.parts, [1]);
  assert.deepEqual(reasonTiles({ ...DEFAULTS, price_ratio: n(0.5, 3) })[2]!.bars[1]!.parts, [1]);
});

test("changed numbers show, are marked, and carry a default tag", () => {
  const tiles = reasonTiles({ ...DEFAULTS, read_share: n(0.42, 0.3), fill_share: n(0.8, 0.85), price_ratio: n(2.5, 3) });
  assert.match(text(tiles[0]!.when), /more than 42% of/);
  assert.match(text(tiles[2]!.when), /model at least 2.5× cheaper/);
  assert.deepEqual(
    tiles[0]!.when.filter((p) => p.changed).map((p) => [p.text, p.tag]),
    [
      ["42%", "default 30%"],
      ["80%", "default 85%"],
    ],
  );
  assert.deepEqual(tiles[2]!.when.filter((p) => p.tag).map((p) => p.tag), ["default 3×"]);
  assert.deepEqual(tiles[1]!.when.filter((p) => p.changed), []);
});

test("the foot says first guess, changed, or measured", () => {
  assert.equal(rulesFoot(DEFAULTS).kind, "guess");
  assert.equal(rulesFoot({ ...DEFAULTS, job_share: n(0.12, 0.1) }).kind, "changed");
  assert.deepEqual(rulesFoot(DEFAULTS, { date: "23 Nov", model: "qwen3.8:27b" }), { kind: "measured", tag: "MEASURED", text: "on 23 Nov with qwen3.8:27b." });
});
