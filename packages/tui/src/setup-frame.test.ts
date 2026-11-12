import assert from "node:assert/strict";
import { test } from "node:test";

import { guided, OVERVIEW, single } from "@golem/view";

import type { Press } from "./keys.ts";
import {
  compactSetup,
  labelWidth,
  lineSpans,
  setupHint,
  setupInner,
  setupKeyOf,
  shortHint,
  stepperSpans,
} from "./setup-frame.ts";

function press(name: Press["name"], input = ""): Press {
  return { name, input, ctrl: false, meta: false };
}

test("the frame is 60 columns, and goes full width under 60×20", () => {
  assert.equal(compactSetup(80, 24), false);
  assert.equal(compactSetup(59, 24), true);
  assert.equal(compactSetup(80, 19), true);
  assert.equal(setupInner(80, 24), 56);
  assert.equal(setupInner(50, 24), 50);
});

test("keys: arrows, Enter, Esc, q quits, Ctrl-C interrupts, r rechecks", () => {
  assert.equal(setupKeyOf(press("up")), "up");
  assert.equal(setupKeyOf(press("return")), "enter");
  assert.equal(setupKeyOf(press("escape")), "back");
  assert.equal(setupKeyOf(press("ctrl-c")), "interrupt");
  assert.equal(setupKeyOf(press(null, "q")), "quit");
  assert.equal(setupKeyOf(press(null, "r")), "recheck");
  assert.equal(setupKeyOf(press(null, "x")), null);
  assert.equal(setupKeyOf({ name: null, input: "q", ctrl: true, meta: false }), null);
});

test("hints follow the screen: q quits only on the first question", () => {
  assert.equal(setupHint("service-ask", guided("service", "start")), "Enter picks · ↑↓ move · q quit");
  assert.equal(setupHint("service-ask", guided("service", "overview")), "Enter picks · ↑↓ move · Esc back");
  assert.equal(setupHint("engine", guided("engine", "send")), "Enter picks · ↑↓ move · Esc back");
  assert.equal(setupHint("overview", OVERVIEW), "Enter picks · ↑↓ move · r recheck · Esc back to chat");
  assert.equal(setupHint("service-wait", guided("service", "start")), "");
  assert.equal(shortHint("Enter picks · ↑↓ move · Esc back"), "Enter · ↑↓ · Esc");
  assert.equal(setupHint("ollama-installing", guided("ollama", "start")), "Esc stops");
  assert.equal(setupHint("model-local", guided("model", "start")), "Enter downloads · ↑↓ move · Esc back");
  assert.equal(setupHint("model-downloading", guided("model", "start")), "Esc keeps it downloading and opens the chat");
  assert.equal(setupHint("model-gone", single("model", "start")), "Enter picks · ↑↓ move · Esc chat without a model");
  assert.equal(setupHint("key-typing", single("key", "chat")), "Enter checks · Esc back");
  assert.equal(setupHint("provider", guided("provider", "start")), "Enter picks · ↑↓ move · Esc back");
});

test("the stepper shows each step's state, and only in guided mode", () => {
  const spans = stepperSpans(guided("engine", "start"));
  assert.deepEqual(
    spans?.map((span) => `${span.tone}:${span.text}`),
    ["ok:✓ Service", "dim: ── ", "clay:● Engine", "dim: ── ", "dim:○ Model", "dim: ── ", "dim:– Tools", "dim: ── ", "dim:○ Ready"],
  );
  assert.equal(stepperSpans(single("model", "overview")), null);
});

test("a status line puts its time on the right, and options line up their details", () => {
  const spans = lineSpans({ kind: "status", mark: "spin", text: "starting the service…", right: "3s" }, 40, 1, 0);
  assert.equal(spans.map((span) => span.text).join("").length, 40);
  assert.equal(spans[0]?.text, "⠙");
  const options = [
    { kind: "option", label: "On this Mac", detail: "private", selected: true },
    { kind: "option", label: "Later", detail: "any time", selected: false },
  ] as const;
  const width = labelWidth(options);
  assert.equal(width, 13);
  assert.deepEqual(
    lineSpans(options[1], 40, 0, width).map((span) => span.text),
    ["  ", "Later        ", "any time"],
  );
  assert.equal(lineSpans(options[0], 40, 0, width)[1]?.tone, "selected");
});

test("a field shows the prompt mark, the hidden key, and a cursor", () => {
  assert.deepEqual(
    lineSpans({ kind: "field", text: "••••" }, 40, 0, 0).map((span) => span.text),
    ["❯ ", "••••", "▏"],
  );
});
