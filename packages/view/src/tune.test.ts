import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelOption, ModelOptionsGetResult } from "@golem/client";

import {
  applyPreset,
  changedRows,
  differsFromDefault,
  focusedRow,
  formatTuneValue,
  keepSession,
  moveFocus,
  PRESETS,
  presetForKey,
  PRESETS_HINT,
  reset,
  sliderCells,
  step,
  toggleTarget,
  tuneRow,
  tuneRows,
  tuneState,
  withSaved,
  withSession,
  written,
} from "./tune.ts";

function option(name: string, extra: Partial<ModelOption> = {}): ModelOption {
  return {
    name,
    label: name,
    kind: "float",
    minimum: 0,
    maximum: 2,
    step: 0.05,
    default: 0.8,
    short: "short",
    long: "long",
    ...extra,
  };
}

const OPTIONS: ModelOption[] = [
  option("temperature"),
  option("top_p", { maximum: 1, step: 0.01, default: 0.9 }),
  option("top_k", { kind: "int", maximum: 200, step: 1, default: 40 }),
  option("num_ctx", { kind: "int", minimum: 512, maximum: 262144, step: 512, default: 4096 }),
  option("seed", { kind: "int", maximum: 2 ** 31 - 1, step: 1, default: null }),
  option("keep_alive", { kind: "duration", minimum: -1, maximum: 86400, step: 60, default: "5m" }),
];

function result(extra: Partial<ModelOptionsGetResult> = {}): ModelOptionsGetResult {
  return {
    model: "qwen3:8b",
    options: OPTIONS,
    defaults: { temperature: 0.7, top_p: 0.9, top_k: 40, num_ctx: 4096, keep_alive: "5m" },
    saved: {},
    ...extra,
  };
}

test("the value in use follows session, then saved, then default", () => {
  const state = tuneState(result({ saved: { temperature: 0.3, top_p: 0.5 }, session: { temperature: 0.1 } }));
  const temperature = tuneRow(state, OPTIONS[0] as ModelOption);
  assert.deepEqual([temperature.value, temperature.source], [0.1, "session"]);
  const topP = tuneRow(state, OPTIONS[1] as ModelOption);
  assert.deepEqual([topP.value, topP.source], [0.5, "saved"]);
  const topK = tuneRow(state, OPTIONS[2] as ModelOption);
  assert.deepEqual([topK.value, topK.source], [40, "default"]);
  const seed = tuneRow(state, OPTIONS[4] as ModelOption);
  assert.deepEqual([seed.value, seed.source], [null, "default"]);
  assert.equal(tuneRows(state).length, OPTIONS.length);
  assert.deepEqual(tuneState(result()).session, {});
});

test("a row differs from the default only when its value does", () => {
  const state = tuneState(result({ saved: { temperature: 0.3, top_p: 0.9 } }));
  assert.equal(differsFromDefault(state, tuneRow(state, OPTIONS[0] as ModelOption)), true);
  assert.equal(differsFromDefault(state, tuneRow(state, OPTIONS[1] as ModelOption)), false);
  assert.equal(differsFromDefault(state, tuneRow(state, OPTIONS[2] as ModelOption)), false);
  assert.equal(differsFromDefault(state, tuneRow(state, OPTIONS[4] as ModelOption)), false);
});

test("step moves by the table's step from the value in use and clamps at both ends", () => {
  let state = tuneState(result());
  state = step(state, "temperature", 1);
  assert.equal(written(state, "temperature"), 0.75);
  assert.equal(state.saved["temperature"], 0.75);
  for (let i = 0; i < 40; i += 1) state = step(state, "temperature", 1);
  assert.equal(written(state, "temperature"), 2);
  for (let i = 0; i < 60; i += 1) state = step(state, "temperature", -1);
  assert.equal(written(state, "temperature"), 0);
  assert.equal(step(state, "nope", 1), state);
});

test("step rounds to the step's decimals, so 0.1 + 0.2 shows 0.3", () => {
  const rows = [option("tenths", { step: 0.1, maximum: 1 })];
  const state = tuneState(result({ options: rows, defaults: { tenths: 0.2 }, saved: {} }));
  const next = step(state, "tenths", 1);
  assert.equal(written(next, "tenths"), 0.3);
  assert.equal(formatTuneValue(rows[0] as ModelOption, 0.1 + 0.2), "0.3");
});

test("num_ctx steps by the table's step and shows in K", () => {
  const state = step(tuneState(result()), "num_ctx", 1);
  assert.equal(written(state, "num_ctx"), 4608);
  const ctx = OPTIONS[3] as ModelOption;
  assert.equal(formatTuneValue(ctx, 4608), "4.5K");
  assert.equal(formatTuneValue(ctx, 16384), "16K");
  assert.equal(formatTuneValue(ctx, 262144), "256K");
});

test("an option with no value starts from its minimum", () => {
  const up = step(tuneState(result()), "seed", 1);
  assert.equal(written(up, "seed"), 1);
  const down = step(tuneState(result()), "seed", -1);
  assert.equal(written(down, "seed"), 0);
  assert.equal(formatTuneValue(OPTIONS[4] as ModelOption, null), "random");
});

test("keep_alive steps through 0, 30s, 5m, 30m, and -1, and stops at the ends", () => {
  let state = tuneState(result());
  state = step(state, "keep_alive", 1);
  assert.equal(written(state, "keep_alive"), "30m");
  state = step(state, "keep_alive", 1);
  assert.equal(written(state, "keep_alive"), -1);
  state = step(state, "keep_alive", 1);
  assert.equal(written(state, "keep_alive"), -1);
  for (const expected of ["30m", "5m", "30s", 0, 0]) {
    state = step(state, "keep_alive", -1);
    assert.equal(written(state, "keep_alive"), expected);
  }
  const custom = tuneState(result({ saved: { keep_alive: "10m" } }));
  assert.equal(written(step(custom, "keep_alive", 1), "keep_alive"), "30m");
  assert.equal(written(step(custom, "keep_alive", -1), "keep_alive"), "5m");
  const keep = OPTIONS[5] as ModelOption;
  assert.deepEqual([formatTuneValue(keep, -1), formatTuneValue(keep, "5m"), formatTuneValue(keep, 0)], ["always", "5m", "0"]);
});

test("a change goes into the target only, and s switches the target", () => {
  let state = tuneState(result());
  state = step(toggleTarget(state), "top_k", 1);
  assert.equal(state.target, "session");
  assert.deepEqual(state.session, { top_k: 41 });
  assert.deepEqual(state.saved, {});
  assert.equal(tuneRow(state, OPTIONS[2] as ModelOption).source, "session");
  assert.equal(toggleTarget(state).target, "saved");
});

test("reset removes the value in the target and the default shows again", () => {
  let state = step(tuneState(result()), "temperature", 1);
  state = reset(state, "temperature");
  assert.deepEqual(state.saved, {});
  assert.equal(written(state, "temperature"), null);
  const row = tuneRow(state, OPTIONS[0] as ModelOption);
  assert.deepEqual([row.value, row.source], [0.7, "default"]);
  const session = reset(toggleTarget(tuneState(result({ saved: { top_k: 5 }, session: { top_k: 9 } }))), "top_k");
  assert.deepEqual(session.session, {});
  assert.deepEqual(session.saved, { top_k: 5 });
});

test("focus moves within the table and stops at its ends", () => {
  let state = tuneState(result());
  assert.equal(moveFocus(state, -1), state);
  state = moveFocus(state, 2);
  assert.equal(focusedRow(state)?.option.name, "top_k");
  state = moveFocus(state, 99);
  assert.equal(state.focus, OPTIONS.length - 1);
});

test("live updates replace the session's overrides, and the saved of this model only", () => {
  const state = tuneState(result({ saved: { temperature: 0.3 } }));
  assert.deepEqual(withSession(state, { top_k: 5 }).session, { top_k: 5 });
  assert.deepEqual(withSaved(state, "qwen3:8b", { top_p: 0.5 }).saved, { top_p: 0.5 });
  assert.equal(withSaved(state, "gemma4:e4b", { top_p: 0.5 }), state);
});

test("sliderCells draws the minimum, the maximum, and a value between", () => {
  const temperature = OPTIONS[0] as ModelOption;
  assert.equal(sliderCells(0, temperature, 10), "▕          ▏");
  assert.equal(sliderCells(2, temperature, 10), "▕██████████▏");
  assert.equal(sliderCells(0, temperature, 15), `▕${" ".repeat(15)}▏`);
  assert.equal(sliderCells(2, temperature, 15), `▕${"█".repeat(15)}▏`);
  // 0.7 of 2.0 is 0.35 of the width: 3.5 cells of 10, and 5.25 cells of 15.
  assert.equal(sliderCells(0.7, temperature, 10), "▕███▌      ▏");
  assert.equal(sliderCells(0.7, temperature, 15), "▕█████▎         ▏");
  assert.equal(sliderCells(null, temperature, 10), sliderCells(0, temperature, 10));
  for (const width of [10, 15]) {
    for (const value of [0, 0.3, 0.7, 1.99, 2]) {
      assert.equal(sliderCells(value, temperature, width).length, width + 2);
    }
  }
});

/** The ranges of the daemon's table (`models/options.py`), for the options a preset names. */
const RANGES: Record<string, [number, number]> = {
  temperature: [0, 2],
  top_p: [0, 1],
  top_k: [0, 200],
  min_p: [0, 1],
  repeat_penalty: [0.5, 2],
  num_ctx: [512, 262144],
};

const PRESET_OPTIONS: ModelOption[] = [
  option("temperature"),
  option("top_p", { maximum: 1, step: 0.01 }),
  option("top_k", { kind: "int", maximum: 200, step: 1 }),
  option("min_p", { maximum: 1, step: 0.01 }),
  option("repeat_penalty", { minimum: 0.5, step: 0.05 }),
  option("num_ctx", { kind: "int", minimum: 512, maximum: 262144, step: 512 }),
];

function presetState(extra: Partial<ModelOptionsGetResult> = {}) {
  return tuneState({
    model: "qwen3:8b",
    options: PRESET_OPTIONS,
    defaults: { temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0, repeat_penalty: 1, num_ctx: 4096 },
    saved: {},
    ...extra,
  });
}

function preset(key: number) {
  const found = presetForKey(key);
  assert.notEqual(found, null);
  return found as NonNullable<typeof found>;
}

test("the presets are on keys 1 to 4 with the values the ticket names", () => {
  assert.deepEqual(PRESETS.map((item) => [item.key, item.id]), [
    [1, "precise"],
    [2, "balanced"],
    [3, "creative"],
    [4, "long-memory"],
  ]);
  assert.deepEqual(preset(1).options, { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 });
  assert.deepEqual(preset(3).options, { temperature: 1.0, top_p: 0.95, min_p: 0.05 });
  assert.deepEqual(preset(4).options, { num_ctx: 16384 });
  assert.equal(presetForKey(5), null);
  assert.equal(PRESETS_HINT, "presets  1 precise   2 balanced   3 creative   4 long memory");
});

test("every preset value is inside the table's range", () => {
  for (const item of PRESETS) {
    for (const [name, value] of Object.entries(item.options)) {
      if (value === null) continue;
      const range = RANGES[name];
      assert.notEqual(range, undefined, `${item.id}: ${name} has no range`);
      const [low, high] = range as [number, number];
      assert.equal(value >= low && value <= high, true, `${item.id}: ${name} ${value}`);
    }
  }
});

test("a preset goes into the session, whatever the target says", () => {
  const saved = presetState({ saved: { temperature: 0.5 } });
  const applied = applyPreset(saved, preset(1));
  assert.deepEqual(applied.options, { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 });
  assert.deepEqual(applied.state.session, { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 });
  assert.deepEqual(applied.state.saved, { temperature: 0.5 });
  assert.equal(applied.state.preset, "precise");
  const session = applyPreset(toggleTarget(saved), preset(1));
  assert.deepEqual(session.state.session, applied.state.session);
});

test("balanced sends null for each sampling option and clears them from the session", () => {
  const creative = applyPreset(presetState(), preset(3)).state;
  const withCtx = { ...creative, session: { ...creative.session, num_ctx: 8192 } };
  const balanced = applyPreset(withCtx, preset(2));
  assert.deepEqual(balanced.options, {
    temperature: null,
    top_p: null,
    top_k: null,
    min_p: null,
    repeat_penalty: null,
  });
  assert.deepEqual(balanced.state.session, { num_ctx: 8192 });
});

test("changedRows names only the rows that moved", () => {
  const before = presetState();
  assert.deepEqual(changedRows(before, before), []);
  const precise = applyPreset(before, preset(1)).state;
  assert.deepEqual(changedRows(before, precise), ["temperature", "repeat_penalty"]);
  assert.deepEqual(precise.lit, ["temperature", "repeat_penalty"]);
  const again = applyPreset(precise, preset(1)).state;
  assert.deepEqual(again.lit, []);
  const back = applyPreset(precise, preset(2)).state;
  assert.deepEqual(back.lit, ["temperature", "repeat_penalty"]);
});

test("keepSession moves the session's values to saved and names what to clear", () => {
  const applied = applyPreset(presetState({ saved: { top_k: 20 } }), preset(1)).state;
  const kept = keepSession(applied);
  assert.deepEqual(kept.save, { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 });
  assert.deepEqual(kept.clear, { temperature: null, top_p: null, repeat_penalty: null });
  assert.deepEqual(kept.state.saved, { top_k: 20, temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 });
  assert.deepEqual(kept.state.session, {});
  assert.equal(kept.state.preset, undefined);
});
