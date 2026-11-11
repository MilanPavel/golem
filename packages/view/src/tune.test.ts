import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelOption, ModelOptionsGetResult } from "@golem/client";

import {
  activePreset,
  applyPreset,
  changedRows,
  defaultNote,
  differsFromDefault,
  focusedRow,
  formatTuneValue,
  groupRows,
  isListKind,
  formatExtraGb,
  keepSession,
  largestFittingCtx,
  memoryFor,
  memoryNote,
  moveFocus,
  NUM_CTX_START,
  PRESETS,
  presetForKey,
  PRESETS_HINT,
  reset,
  sliderCells,
  step,
  toggleTarget,
  tuneChip,
  tuneHint,
  tuneRow,
  tuneRows,
  tuneSet,
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
  assert.deepEqual(preset(4).options, { num_ctx: 16384 }, "the fallback with no memory known");
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

const MEMORY = { kv_gb_per_1k_tokens: 0.06, overhead_gb: 1, fits_share: 0.5, tight_share: 0.75 };

// The same cases as test_fit in packages/daemon/tests/test_prices.py, with the default window of 8192.
for (const [size, ram, ctx, expected] of [
  [5.2, 36, 8192, "fits"],
  [5.2, 36, 32768, "fits"],
  [18.6, 36, 8192, "tight"],
  [40, 36, 8192, "too_big"],
  [3.3, 8, 8192, "tight"],
  [5.2, 8, 8192, "too_big"],
  [13.8, 16, 8192, "too_big"],
] as const) {
  test(`memoryFor gives the daemon's verdict: ${size} GB in ${ram} GB with ${ctx} is ${expected}`, () => {
    const memory = { ram_gb: ram, size_gb: size, ...MEMORY };
    assert.equal(memoryFor(ctx, memory, 4096).fit, expected);
  });
}

test("memoryFor's extra is the KV cache over the default's, negative below it", () => {
  const memory = { ram_gb: 36, size_gb: 5.2, ...MEMORY };
  assert.equal(formatExtraGb(memoryFor(16384, memory, 4096).extraGb), "+0.7 GB");
  assert.equal(formatExtraGb(memoryFor(20480, memory, 2048).extraGb), "+1.1 GB");
  assert.equal(formatExtraGb(memoryFor(8192, memory, 16384).extraGb), "−0.5 GB");
  assert.equal(formatExtraGb(memoryFor(4096, memory, 4096).extraGb), "+0.0 GB");
});

test("the gauge is for num_ctx only, and only when the memory is known", () => {
  const memory = { ram_gb: 36, size_gb: 5.2, ...MEMORY };
  const known = tuneState(result({ memory, saved: { num_ctx: 16384 } }));
  const ctx = tuneRows(known).find((row) => row.option.name === "num_ctx") as ReturnType<typeof tuneRows>[number];
  assert.deepEqual(memoryNote(known, ctx), { text: "+0.7 GB · fits", fit: "fits" });
  const other = tuneRows(known).find((row) => row.option.name === "top_p") as ReturnType<typeof tuneRows>[number];
  assert.equal(memoryNote(known, other), null);
  const unknown = tuneState(result({ saved: { num_ctx: 16384 } }));
  assert.equal(memoryNote(unknown, ctx), null);
});

test("a window that does not load says so", () => {
  const memory = { ram_gb: 16, size_gb: 13.8, ...MEMORY };
  const state = tuneState(result({ memory }));
  const ctx = tuneRows(state).find((row) => row.option.name === "num_ctx") as ReturnType<typeof tuneRows>[number];
  const note = memoryNote(state, ctx);
  assert.equal(note?.fit, "too_big");
  assert.equal(note?.text, "+0.0 GB · too big");
  assert.equal(note?.warning, "This may not load on this Mac.");
});

test("long memory picks the largest num_ctx step that fits, at most 32768", () => {
  const roomy = tuneState(result({ memory: { ram_gb: 36, size_gb: 5.2, ...MEMORY } }));
  assert.deepEqual(applyPreset(roomy, preset(4)).options, { num_ctx: 32768 });
  const small = tuneState(result({ memory: { ram_gb: 16, size_gb: 6.2, ...MEMORY } }));
  const picked = applyPreset(small, preset(4)).options["num_ctx"] as number;
  assert.equal(picked, 13312);
  assert.equal(memoryFor(picked, { ram_gb: 16, size_gb: 6.2, ...MEMORY }, 4096).fit, "fits");
  assert.equal(memoryFor(picked + 512, { ram_gb: 16, size_gb: 6.2, ...MEMORY }, 4096).fit, "tight");
  const option = OPTIONS.find((item) => item.name === "num_ctx") as ModelOption;
  assert.equal(largestFittingCtx(option, { ram_gb: 8, size_gb: 3.3, ...MEMORY }), null);
  const none = tuneState(result({ memory: { ram_gb: 8, size_gb: 3.3, ...MEMORY } }));
  assert.deepEqual(applyPreset(none, preset(4)).options, { num_ctx: 16384 });
});

const withoutNumCtx = () => Object.fromEntries(Object.entries(result().defaults).filter(([name]) => name !== "num_ctx"));
const numCtxRow = (state: ReturnType<typeof tuneState>) =>
  tuneRows(state).find((row) => row.option.name === "num_ctx") as ReturnType<typeof tuneRows>[number];

test("num_ctx with no default and no value says Ollama sets it when it loads", () => {
  const defaults = withoutNumCtx();
  const state = tuneState(result({ defaults }));
  assert.equal(numCtxRow(state).value, null);
  assert.equal(defaultNote(state, numCtxRow(state)), "set by Ollama when it loads");
  const seed = tuneRows(state).find((row) => row.option.name === "seed") as ReturnType<typeof tuneRows>[number];
  assert.equal(defaultNote(state, seed), null);
});

test("a default from Ollama or the Modelfile says where it came from", () => {
  const ollama = tuneState(result({ defaults: { num_ctx: 32768 }, default_from: { num_ctx: "ollama" } }));
  assert.equal(defaultNote(ollama, numCtxRow(ollama)), "model default 32K · from Ollama");
  const modelfile = tuneState(result({ defaults: { num_ctx: 8192 }, default_from: { num_ctx: "modelfile" }, saved: { num_ctx: 16384 } }));
  assert.equal(defaultNote(modelfile, numCtxRow(modelfile)), "model default 8K · from the Modelfile");
  const plain = tuneState(result({ saved: { top_k: 20 } }));
  const topK = tuneRows(plain).find((row) => row.option.name === "top_k") as ReturnType<typeof tuneRows>[number];
  assert.equal(defaultNote(plain, topK), "model default 40");
});

test("memoryFor with no base gives the KV cache of the window alone", () => {
  const memory = { ram_gb: 36, size_gb: 5.2, ...MEMORY };
  const got = memoryFor(16384, memory, null);
  assert.equal(got.extraGb, 16 * 0.06);
  assert.equal(got.fit, "fits");
  const defaults = withoutNumCtx();
  const state = tuneState(result({ defaults, memory, saved: { num_ctx: 16384 } }));
  assert.deepEqual(memoryNote(state, numCtxRow(state)), { text: "1.0 GB for the window · fits", fit: "fits" });
});

test("the first step from no default starts at 8192", () => {
  const defaults = withoutNumCtx();
  const state = tuneState(result({ defaults }));
  const first = step(state, "num_ctx", 1);
  assert.equal(numCtxRow(first).value, NUM_CTX_START);
  assert.equal(NUM_CTX_START, 8192);
  assert.equal(numCtxRow(step(first, "num_ctx", -1)).value, 7680);
  assert.equal(numCtxRow(step(state, "num_ctx", -1)).value, 8192);
});

test("the chip lists only changed values, in table order, with temperature as temp", () => {
  const base = tuneState(result());
  assert.equal(tuneChip(base, "ollama"), "");
  const changed = withSession(base, { top_p: 0.5, temperature: 0.2 });
  assert.equal(tuneChip(changed, "ollama"), "temp 0.2 · top_p 0.5");
  assert.equal(tuneChip(withSession(base, { temperature: 0.7 }), "ollama"), "");
  assert.equal(tuneChip(withSaved(base, "qwen3:8b", { top_k: 10 }), "ollama"), "top_k 10");
});

test("the chip leaves out num_ctx, cuts at three with +N, and is empty on a hosted model", () => {
  const base = tuneState(result());
  assert.equal(tuneChip(withSession(base, { num_ctx: 8192 }), "ollama"), "");
  const many = withSession(base, { temperature: 0.2, top_p: 0.5, top_k: 10, seed: 7, keep_alive: "30m", num_ctx: 8192 });
  assert.equal(tuneChip(many, "ollama"), "temp 0.2 · top_p 0.5 · top_k 10 +2");
  assert.equal(tuneChip(many, "anthropic"), "");
  assert.equal(tuneChip(null, "ollama"), "");
});

test("/tune <option> <value> checks the table and says the range", () => {
  assert.deepEqual(tuneSet(OPTIONS, ["temperature", "0.3"]), {
    kind: "set",
    name: "temperature",
    value: 0.3,
    notice: "temperature 0.3 for this session",
  });
  assert.deepEqual(tuneSet(OPTIONS, ["temperature", "reset"]), {
    kind: "set",
    name: "temperature",
    value: null,
    notice: "temperature reset for this session",
  });
  assert.deepEqual(tuneSet(OPTIONS, ["temperature", "3"]), {
    kind: "error",
    notice: "temperature is between 0 and 2",
  });
  assert.equal(tuneSet(OPTIONS, ["top_k", "1.5"]).kind, "error");
  assert.equal(tuneSet(OPTIONS, ["temperature", "hot"]).kind, "error");
  assert.equal(tuneSet(OPTIONS, ["nope", "1"]).kind, "error");
  assert.equal(tuneSet(OPTIONS, ["keep_alive", "10m"]).kind, "set");
  assert.equal(tuneSet(OPTIONS, ["keep_alive", "soon"]).kind, "error");
  assert.equal(tuneSet([], ["temperature", "0.3"]).kind, "error");
});

test("the hint after an option name is its default and range", () => {
  assert.equal(tuneHint(OPTIONS[0] as ModelOption, { temperature: 0.7 }), "0.7 · 0–2");
  assert.equal(tuneHint(OPTIONS[0] as ModelOption), "0.8 · 0–2");
  const numCtx = OPTIONS.find((item) => item.name === "num_ctx") as ModelOption;
  assert.equal(tuneHint({ ...numCtx, default: null }), "set by Ollama · 512–262144");
  assert.equal(tuneHint(numCtx, { num_ctx: 32768 }), "32K · 512–262144");
});

const THINK = option("think", { kind: "choice", values: ["off", "on"], minimum: null, maximum: null, step: null, default: null });
const LEVELS = option("think", { kind: "choice", values: ["low", "medium", "high"], minimum: null, maximum: null, step: null, default: null });

function thinking(extra: Partial<ModelOptionsGetResult> = {}, think: ModelOption = THINK): ModelOptionsGetResult {
  return result({ options: [...OPTIONS, think], ...extra });
}

test("isListKind is true for a duration and a choice only", () => {
  assert.equal(isListKind(THINK), true);
  assert.equal(isListKind(OPTIONS[5] as ModelOption), true);
  assert.equal(isListKind(OPTIONS[0] as ModelOption), false);
});

test("think steps through its values and stops at the ends", () => {
  let state = tuneState(thinking());
  state = step(state, "think", 1);
  assert.equal(written(state, "think"), "off");
  state = step(state, "think", 1);
  assert.equal(written(state, "think"), "on");
  state = step(state, "think", 1);
  assert.equal(written(state, "think"), "on");
  state = step(state, "think", -1);
  assert.equal(written(state, "think"), "off");
  state = step(state, "think", -1);
  assert.equal(written(state, "think"), "off");
  const levels = step(tuneState(thinking({}, LEVELS)), "think", -1);
  assert.equal(written(levels, "think"), "high");
  assert.equal(written(step(levels, "think", -1), "think"), "medium");
});

test("think shows its value, says the model default, and is the chip when set", () => {
  const state = tuneState(thinking());
  const row = tuneRow(state, THINK);
  assert.equal(row.value, null);
  assert.equal(formatTuneValue(THINK, row.value), "unset");
  assert.equal(defaultNote(state, row), "model default · thinks");
  assert.equal(tuneChip(state, "ollama"), "");
  const off = tuneState(thinking({ saved: { think: "off" } }));
  assert.equal(formatTuneValue(THINK, "off"), "off");
  assert.equal(tuneChip(off, "ollama"), "think off");
  const high = tuneState(thinking({ session: { think: "high" } }, LEVELS));
  assert.equal(tuneChip(high, "ollama"), "think high");
  const many = withSession(tuneState(thinking()), { temperature: 0.2, top_p: 0.5, top_k: 10, think: "on" });
  assert.equal(tuneChip(many, "ollama"), "temp 0.2 · top_p 0.5 · top_k 10 +1");
});

test("/tune think accepts only the model's values and says the allowed ones", () => {
  assert.deepEqual(tuneSet([...OPTIONS, LEVELS], ["think", "high"]), {
    kind: "set",
    name: "think",
    value: "high",
    notice: "think high for this session",
  });
  assert.deepEqual(tuneSet([...OPTIONS, THINK], ["think", "high"]), {
    kind: "error",
    notice: "think is one of off, on",
  });
  assert.equal(tuneSet([...OPTIONS, THINK], ["think", "reset"]).kind, "set");
  assert.match(tuneSet(OPTIONS, ["think", "on"]).notice, /think is not an option to tune/);
  assert.equal(tuneHint(LEVELS), "model default · low, medium, high");
  assert.equal(tuneHint(OPTIONS[5] as ModelOption, { keep_alive: "5m" }), "5m · a time such as 5m, or -1");
});

test("rows fall into Sampling, Memory, and Output, and an unknown option into Other at the end", () => {
  const extra = [...OPTIONS, option("mystery")];
  const groups = groupRows(tuneRows(tuneState(result({ options: extra }))));
  assert.deepEqual(
    groups.map((group) => [group.label, group.rows.map((row) => row.option.name)]),
    [
      ["Sampling", ["temperature", "top_p", "top_k"]],
      ["Memory", ["num_ctx", "keep_alive"]],
      ["Output", ["seed"]],
      ["Other", ["mystery"]],
    ],
  );
  assert.deepEqual(groupRows(tuneRows(tuneState(result()))).map((group) => group.id), ["sampling", "memory", "output"]);
});

test("a preset is active only while the values in use match it", () => {
  const plain = tuneState(result());
  assert.equal(activePreset(plain)?.id, "balanced");
  const precise = applyPreset(plain, PRESETS[0] as (typeof PRESETS)[number]).state;
  assert.equal(activePreset(precise)?.id, "precise");
  assert.equal(activePreset(withSession(precise, { ...precise.session, temperature: 0.5 })), null);
});
