import assert from "node:assert/strict";
import { test } from "node:test";

import { applyComposer, closedDebug, toggleDebugTab, type DebugState } from "./commands.ts";

test("a sentence is sent and a slash command is not", () => {
  const sentence = applyComposer(closedDebug, "hello");
  assert.equal(sentence.kind, "send");
  if (sentence.kind === "send") {
    assert.equal(sentence.text, "hello");
  }

  const debug = applyComposer(closedDebug, "/debug");
  assert.equal(debug.kind, "local");
  if (debug.kind === "local") {
    assert.equal(debug.debug.open, true);
    assert.equal(debug.debug.tab, "wire");
  }

  const model = applyComposer(closedDebug, "/debug model");
  assert.equal(model.kind, "local");
  if (model.kind === "local") {
    assert.equal(model.debug.open, true);
    assert.equal(model.debug.tab, "model");
    assert.equal(model.refreshModel, true);
  }

  const wire = applyComposer(model.kind === "local" ? model.debug : closedDebug, "/debug wire");
  assert.equal(wire.kind, "local");
  if (wire.kind === "local") {
    assert.equal(wire.debug.tab, "wire");
  }
});

test("a doubled slash sends the rest as a normal message", () => {
  const outcome = applyComposer(closedDebug, "//hello");
  assert.equal(outcome.kind, "send");
  if (outcome.kind === "send") {
    assert.equal(outcome.text, "hello");
  }
});

test("an unknown slash command stays out of the model", () => {
  const outcome = applyComposer(closedDebug, "/foo");
  assert.deepEqual(outcome, { kind: "unknown", notice: "unknown command" });
  assert.equal(applyComposer(closedDebug, "/debug extra").kind, "unknown");
});

test("tab switches wire and model while the panel is open", () => {
  const open = { ...closedDebug, open: true, tab: "wire" as const };
  const model = toggleDebugTab(open);
  assert.equal(model.tab, "model");
  assert.equal(toggleDebugTab(model).tab, "wire");
  assert.equal(toggleDebugTab(closedDebug), closedDebug);
});

test("/debug toggles the panel", () => {
  const opened = applyComposer(closedDebug, "/debug");
  assert.equal(opened.kind, "local");
  if (opened.kind !== "local") {
    return;
  }
  const closed = applyComposer(opened.debug, "/debug");
  assert.equal(closed.kind, "local");
  if (closed.kind === "local") {
    assert.equal(closed.debug.open, false);
  }
});

test("hold shows the line and go is what sends it", () => {
  const armed = applyComposer(closedDebug, "/debug hold");
  assert.equal(armed.kind, "local");
  if (armed.kind !== "local") {
    return;
  }
  assert.equal(armed.debug.hold, true);

  const preview = applyComposer(armed.debug, "hello");
  assert.equal(preview.kind, "local");
  if (preview.kind !== "local") {
    return;
  }
  assert.equal(preview.debug.held, "hello");
  assert.equal(preview.debug.tab, "model");

  const sent = applyComposer(preview.debug, "/debug go");
  assert.equal(sent.kind, "send");
  if (sent.kind === "send") {
    assert.equal(sent.text, "hello");
    assert.equal(sent.debug.hold, false);
    assert.equal(sent.debug.held, null);
  }
});

test("go with nothing held does not send", () => {
  const outcome = applyComposer(closedDebug, "/debug go");
  assert.equal(outcome.kind, "local");
  if (outcome.kind === "local") {
    assert.equal(outcome.notice, "nothing held");
  }
});

test("hold again puts the unsent line back", () => {
  const held: DebugState = { open: true, tab: "model", hold: true, held: "hello" };
  const outcome = applyComposer(held, "/debug hold");
  assert.equal(outcome.kind, "local");
  if (outcome.kind === "local") {
    assert.equal(outcome.debug.hold, false);
    assert.equal(outcome.debug.held, null);
    assert.equal(outcome.restore, "hello");
  }
});

test("/sessions and /new are commands without arguments", () => {
  assert.deepEqual(applyComposer(closedDebug, "/sessions"), { kind: "sessions" });
  assert.deepEqual(applyComposer(closedDebug, " /new "), { kind: "new" });
  assert.equal(applyComposer(closedDebug, "/new now").kind, "unknown");
  assert.equal(applyComposer(closedDebug, "/session").kind, "unknown");
});

test("/title takes the rest of the line as the name, or nothing to show it", () => {
  assert.deepEqual(applyComposer(closedDebug, "/title  Trip   plans "), { kind: "title", title: "Trip plans" });
  assert.deepEqual(applyComposer(closedDebug, "/title"), { kind: "title", title: null });
});
