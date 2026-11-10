import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelOption, ModelOptionsGetResult } from "@golem/client";
import { tuneState, type TuneState } from "@golem/view";

import type { Press, PressName } from "./keys.ts";
import { pressTune, tuneKeyOf, tuneLines, tuneLitLines, tuneMemorySpans, tuneOpening } from "./tune-panel.ts";

function press(name: PressName | null, input = "", ctrl = false): Press {
  return { name, input, ctrl, meta: false };
}

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
    long: `About ${name}. It has a long text that has to wrap at the width of the terminal and not run over.`,
    ...extra,
  };
}

const RESULT: ModelOptionsGetResult = {
  model: "qwen3:8b",
  options: [
    option("temperature"),
    option("top_p", { maximum: 1, step: 0.01, default: 0.9 }),
    option("num_ctx", { kind: "int", minimum: 512, maximum: 262144, step: 512, default: 4096 }),
    option("keep_alive", { kind: "duration", minimum: -1, maximum: 86400, step: 60, default: "5m" }),
  ],
  defaults: { temperature: 0.7, top_p: 0.9, num_ctx: 4096, keep_alive: "5m" },
  saved: {},
};

function open(extra: Partial<ModelOptionsGetResult> = {}): TuneState {
  return tuneState({ ...RESULT, ...extra });
}

const LOCAL = { connected: true, sessionId: "s1", provider: "ollama", name: "qwen3:8b" };

test("/tune on a hosted model gives the notice and opens nothing", () => {
  assert.deepEqual(tuneOpening({ ...LOCAL, provider: "anthropic", name: "claude-sonnet-5-5" }), {
    kind: "notice",
    text: "Tuning is for local Ollama models. claude-sonnet-5-5 is hosted.",
  });
});

test("/tune with no session, no connection, or no model gives a notice", () => {
  assert.deepEqual(tuneOpening({ ...LOCAL, sessionId: null }), { kind: "notice", text: "open a session first" });
  assert.deepEqual(tuneOpening({ ...LOCAL, connected: false }), { kind: "notice", text: "open a session first" });
  assert.equal(tuneOpening({ ...LOCAL, provider: null, name: null }).kind, "notice");
  assert.deepEqual(tuneOpening(LOCAL), { kind: "open", model: "qwen3:8b", sessionId: "s1" });
});

test("keys map to the panel's keys, and others do nothing", () => {
  assert.equal(tuneKeyOf(press("up")), "up");
  assert.equal(tuneKeyOf(press("down")), "down");
  assert.equal(tuneKeyOf(press("left")), "left");
  assert.equal(tuneKeyOf(press("right")), "right");
  assert.equal(tuneKeyOf(press("escape")), "close");
  assert.equal(tuneKeyOf(press("ctrl-c", "c", true)), "close");
  assert.equal(tuneKeyOf(press(null, "r")), "reset");
  assert.equal(tuneKeyOf(press(null, "s")), "target");
  assert.equal(tuneKeyOf(press(null, "x")), null);
  assert.equal(tuneKeyOf(press(null, "r", true)), null);
  assert.equal(tuneKeyOf(press("return")), null);
});

test("right and left change the focused value and send it for the model", () => {
  const right = pressTune(open(), "right");
  assert.deepEqual(right.action, { kind: "change", name: "temperature", value: 0.75, target: "saved" });
  const left = pressTune(right.state, "left");
  assert.deepEqual(left.action, { kind: "change", name: "temperature", value: 0.7, target: "saved" });
  const down = pressTune(pressTune(open(), "down").state, "right");
  assert.deepEqual(down.action, { kind: "change", name: "top_p", value: 0.91, target: "saved" });
});

test("s sends changes to the session only, and r sends null for that name", () => {
  let state = pressTune(open(), "target").state;
  assert.equal(state.target, "session");
  const changed = pressTune(state, "right");
  assert.deepEqual(changed.action, { kind: "change", name: "temperature", value: 0.75, target: "session" });
  state = changed.state;
  const cleared = pressTune(state, "reset");
  assert.deepEqual(cleared.action, { kind: "change", name: "temperature", value: null, target: "session" });
  const saved = pressTune(pressTune(open({ saved: { temperature: 0.3 } }), "reset").state, "reset");
  assert.deepEqual(saved.action, { kind: "change", name: "temperature", value: null, target: "saved" });
});

test("up and down move the focus without sending, and Esc closes", () => {
  const moved = pressTune(open(), "down");
  assert.equal(moved.state.focus, 1);
  assert.deepEqual(moved.action, { kind: "none" });
  assert.deepEqual(pressTune(open(), "close").action, { kind: "close" });
});

test("a duration row steps through its times", () => {
  let state = open();
  for (let i = 0; i < 3; i += 1) state = pressTune(state, "down").state;
  const next = pressTune(state, "right");
  assert.deepEqual(next.action, { kind: "change", name: "keep_alive", value: "30m", target: "saved" });
});

test("the panel shows a row for each option, the default note, the long text, and the keys", () => {
  const lines = tuneLines(open({ saved: { temperature: 0.7, top_p: 0.5 } }), 80);
  assert.equal(lines[0]?.startsWith(" tune · qwen3:8b"), true);
  assert.equal(lines[0]?.endsWith("saved for this model · s this session only"), true);
  assert.equal(lines.length > 6, true);
  const temperature = lines.find((line) => line.includes("▸ temperature")) as string;
  assert.match(temperature, /▕[█▏▎▍▌▋▊▉ ]+▏ 0\.7/);
  assert.equal(temperature.includes("model default"), false);
  const topP = lines.find((line) => line.includes("top_p")) as string;
  assert.equal(topP.includes("model default 0.9"), true);
  const ctx = lines.find((line) => line.includes("num_ctx")) as string;
  assert.equal(ctx.includes("4K"), true);
  const keep = lines.find((line) => line.includes("keep_alive")) as string;
  assert.equal(keep.includes("▕"), false);
  assert.equal(keep.includes("5m"), true);
  assert.equal(lines.some((line) => line.startsWith("─ temperature ─")), true);
  assert.equal(lines.some((line) => line.includes("About temperature.")), true);
  assert.equal(lines[lines.length - 2], " ↑/↓ move · ←/→ change · r reset · t try again · Esc close");
  assert.equal(lines[lines.length - 1], " presets  1 precise   2 balanced   3 creative   4 long memory");
});

test("the header says where changes go", () => {
  const session = tuneLines(pressTune(open(), "target").state, 80);
  assert.equal(session[0]?.endsWith("this session only · s saved for this model"), true);
});

test("a session value is marked, and no line is wider than the terminal", () => {
  const state = open({ session: { temperature: 0.2 } });
  assert.equal(tuneLines(state, 80).some((line) => line.includes("model default 0.7 · this session")), true);
  for (const columns of [20, 40, 60, 80, 120]) {
    for (const line of tuneLines(state, columns)) {
      assert.equal(line.length <= columns, true, `${columns}: ${line}`);
    }
  }
});

test("the long text wraps to the terminal", () => {
  const lines = tuneLines(open(), 40);
  const start = lines.findIndex((line) => line.startsWith("─ temperature"));
  const end = lines.length - 1;
  assert.equal(end - start > 2, true);
});

test("1 to 4 and S map to preset and save keys", () => {
  assert.equal(tuneKeyOf(press(null, "1")), "preset-1");
  assert.equal(tuneKeyOf(press(null, "4")), "preset-4");
  assert.equal(tuneKeyOf(press(null, "5")), null);
  assert.equal(tuneKeyOf(press(null, "S")), "save");
  assert.equal(tuneKeyOf(press(null, "S", true)), null);
});

test("pressing 1 sends precise's values to the session, even when changes go to the model", () => {
  const pressed = pressTune(open(), "preset-1");
  assert.deepEqual(pressed.action, {
    kind: "preset",
    options: { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 },
  });
  assert.deepEqual(pressed.state.session, { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 });
  assert.equal(pressed.state.target, "saved");
  assert.deepEqual(pressed.state.saved, {});
});

test("the header names the preset, the moved rows light up, and the next key ends it", () => {
  const pressed = pressTune(open(), "preset-1").state;
  const lines = tuneLines(pressed, 80);
  assert.equal(lines[0]?.endsWith("preset precise · this session"), true);
  assert.deepEqual(tuneLitLines(pressed), [1]);
  const moved = pressTune(pressed, "down").state;
  assert.deepEqual(tuneLitLines(moved), []);
  assert.equal(tuneLines(moved, 80)[0]?.endsWith("preset precise · this session"), true);
  const edited = pressTune(moved, "right").state;
  assert.equal(tuneLines(edited, 80)[0]?.endsWith("saved for this model · s this session only"), true);
});

test("S saves the session's values for the model and clears them, and does nothing with none", () => {
  const applied = pressTune(open(), "preset-1").state;
  assert.equal(tuneLines(applied, 80).some((line) => line.startsWith(" S save")), true);
  const kept = pressTune(applied, "save");
  assert.deepEqual(kept.action, {
    kind: "save",
    save: { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 },
    clear: { temperature: null, top_p: null, repeat_penalty: null },
  });
  assert.deepEqual(kept.state.session, {});
  assert.deepEqual(kept.state.saved, { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 });
  assert.deepEqual(pressTune(open(), "save").action, { kind: "none" });
});

const MEMORY = { kv_gb_per_1k_tokens: 0.06, overhead_gb: 1, fits_share: 0.5, tight_share: 0.75 };

test("the num_ctx row shows the memory of the value, and nothing when it is not known", () => {
  const known = open({ saved: { num_ctx: 16384 }, memory: { ram_gb: 36, size_gb: 5.2, ...MEMORY } });
  const lines = tuneLines(known, 100);
  assert.match(lines.find((line) => line.includes("num_ctx")) as string, /16K\s+\+0\.7 GB · fits/);
  assert.deepEqual(tuneMemorySpans(known, 100).map((span) => [span.line, span.fit]), [[3, "fits"]]);
  const below = tuneLines(open({ saved: { num_ctx: 2048 }, memory: { ram_gb: 36, size_gb: 5.2, ...MEMORY } }), 100);
  assert.equal(below.some((line) => line.includes("−0.1 GB · fits")), true);
  const none = open({ saved: { num_ctx: 16384 } });
  assert.equal(tuneLines(none, 100).some((line) => line.includes("GB")), false);
  assert.deepEqual(tuneMemorySpans(none, 100), []);
});

test("a window too big for the machine is flagged, and the explanation warns", () => {
  const big = open({ saved: { num_ctx: 32768 }, memory: { ram_gb: 8, size_gb: 5.2, ...MEMORY } });
  const focused = { ...big, focus: 2 };
  const lines = tuneLines(focused, 100);
  assert.equal(lines.some((line) => line.includes("· too big")), true);
  assert.equal(lines.join(" ").includes("This may not load on this Mac."), true);
  assert.equal(tuneMemorySpans(big, 100)[0]?.fit, "too_big");
  const quiet = tuneLines({ ...big, focus: 0 }, 100);
  assert.equal(quiet.join(" ").includes("This may not load"), false);
});
