import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelOption, ModelOptionsGetResult } from "@golem/client";
import { tuneState, type TuneState } from "@golem/view";

import type { Press, PressName } from "./keys.ts";
import { pressTune, tuneKeyOf, tuneLines, tuneOpening } from "./tune-panel.ts";

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
  assert.equal(lines[lines.length - 1], " ↑/↓ move · ←/→ change · r reset · t try again · Esc close");
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
