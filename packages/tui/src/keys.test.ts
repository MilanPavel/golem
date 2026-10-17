import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyPress,
  isF1,
  KEY_CONTEXTS,
  KEYS,
  keyOverlayLines,
  moveOverlayOffset,
  pressKey,
  type KeyBinding,
  type KeyFlags,
  type KeyPlace,
} from "./keys.ts";

function place(overrides: Partial<KeyPlace> = {}): KeyPlace {
  return {
    overlay: false,
    help: false,
    switcher: false,
    debug: false,
    draftEmpty: true,
    busy: false,
    connected: true,
    suggestions: false,
    history: false,
    ...overrides,
  };
}

function flags(overrides: Partial<KeyFlags> = {}): KeyFlags {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...overrides,
  };
}

test("every key has a description, and the overlay is only the table", () => {
  assert.equal(KEYS.length > 0, true);
  const lines = keyOverlayLines(KEYS, 160);
  const text = lines.map((line) => line.text).join("\n");
  for (const key of KEYS) {
    assert.equal(key.description.trim().length > 0, true);
    assert.equal(key.contexts.length > 0, true);
    assert.equal(text.includes(key.label), true);
    assert.equal(text.includes(key.description), true);
  }
  for (const context of KEY_CONTEXTS) {
    assert.equal(
      lines.some((line) => line.dim && line.text === context),
      true,
    );
  }

  const only: KeyBinding = {
    id: "only",
    label: "Z",
    contexts: ["composer"],
    description: "Does a thing",
    when: { name: "tab" },
    run: () => ({ kind: "ignore" }),
  };
  assert.deepEqual(keyOverlayLines([only], 80), [
    { text: "composer", dim: true },
    { text: "  Z  Does a thing", dim: false },
  ]);
});

test("keys dispatch through the table", () => {
  const pressed = (input: string, key: Partial<KeyFlags>, where: Partial<KeyPlace> = {}) =>
    pressKey(place(where), classifyPress(input, flags(key)));

  assert.deepEqual(pressed("c", { ctrl: true }, { overlay: true }), { kind: "cancel" });
  assert.deepEqual(pressKey(place(), { name: "f1", input: "", ctrl: false, meta: false }), {
    kind: "toggle-overlay",
  });
  assert.deepEqual(pressKey(place({ overlay: true }), { name: "f1", input: "", ctrl: false, meta: false }), {
    kind: "toggle-overlay",
  });
  assert.deepEqual(pressed("", {}, { overlay: false, draftEmpty: true }), { kind: "ignore" });
  assert.deepEqual(pressed("?", { shift: true }, { draftEmpty: true }), { kind: "toggle-overlay" });
  assert.deepEqual(pressed("?", { shift: true }, { draftEmpty: false }), { kind: "insert", text: "?" });
  assert.deepEqual(pressed("?", { shift: true }, { overlay: true }), { kind: "close-overlay" });
  assert.deepEqual(pressed("", { escape: true }, { overlay: true, debug: true }), { kind: "close-overlay" });
  assert.deepEqual(pressed("", { escape: true }, { help: true, debug: true }), { kind: "close-help" });
  assert.deepEqual(pressed("", { escape: true }, { switcher: true, debug: true }), {
    kind: "switcher",
    key: "close",
  });
  assert.deepEqual(pressed("", { escape: true }, { debug: true }), { kind: "close-debug" });
  assert.deepEqual(pressed("", { pageUp: true }, { overlay: true, switcher: true }), {
    kind: "scroll-overlay",
    toward: "up",
  });
  assert.deepEqual(pressed("", { pageUp: true }, { switcher: true }), { kind: "ignore" });
  assert.deepEqual(pressed("", { pageUp: true }, { debug: true }), { kind: "scroll", target: "debug", toward: "up" });
  assert.deepEqual(pressed("", { pageDown: true }), { kind: "scroll", target: "transcript", toward: "down" });
  assert.deepEqual(pressed("", { home: true }), { kind: "scroll", target: "transcript", toward: "start" });
  assert.deepEqual(pressed("", { end: true }), { kind: "scroll", target: "transcript", toward: "end" });
  assert.deepEqual(pressed("", { upArrow: true }, { switcher: true }), { kind: "switcher", key: "up" });
  assert.deepEqual(pressed("", { downArrow: true }, { switcher: true }), { kind: "switcher", key: "down" });
  assert.deepEqual(pressed("", { return: true }, { switcher: true }), { kind: "switcher", key: "enter" });
  assert.deepEqual(pressed("n", {}, { switcher: true }), { kind: "switcher", key: "new" });
  assert.deepEqual(pressed("n", {}), { kind: "insert", text: "n" });
  assert.deepEqual(pressed("", { upArrow: true }, { suggestions: true }), { kind: "suggest", key: "up" });
  assert.deepEqual(pressed("", { downArrow: true }, { suggestions: true }), { kind: "suggest", key: "down" });
  assert.deepEqual(pressed("", { upArrow: true }, { suggestions: true, switcher: true }), {
    kind: "switcher",
    key: "up",
  });
  assert.deepEqual(pressed("", { escape: true }, { suggestions: true, help: true, debug: true }), {
    kind: "suggest",
    key: "close",
  });
  assert.deepEqual(pressed("", { tab: true }, { suggestions: true, debug: true }), { kind: "suggest", key: "tab" });
  assert.deepEqual(pressed("", { return: true }, { suggestions: true, connected: false }), {
    kind: "suggest",
    key: "enter",
  });
  assert.deepEqual(pressed("", { upArrow: true }, { draftEmpty: true }), { kind: "history", key: "older" });
  assert.deepEqual(pressed("", { upArrow: true }, { draftEmpty: false }), { kind: "ignore" });
  assert.deepEqual(pressed("", { upArrow: true }, { draftEmpty: false, history: true }), {
    kind: "history",
    key: "older",
  });
  assert.deepEqual(pressed("", { downArrow: true }, { history: true }), { kind: "history", key: "newer" });
  assert.deepEqual(pressed("", { downArrow: true }), { kind: "ignore" });
  assert.deepEqual(pressed("", { escape: true }, { history: true, help: true, debug: true }), {
    kind: "history",
    key: "close",
  });
  assert.deepEqual(pressed("", { upArrow: true }, { suggestions: true, history: true, draftEmpty: true }), {
    kind: "suggest",
    key: "up",
  });
  assert.deepEqual(pressed("", { return: true }), { kind: "submit" });
  assert.deepEqual(pressed("", { return: true }, { connected: false }), { kind: "ignore" });
  assert.deepEqual(pressed("", { backspace: true }), { kind: "edit", op: "backspace" });
  assert.deepEqual(pressed("", { delete: true }), { kind: "edit", op: "delete" });
  assert.deepEqual(pressed("", { delete: true }, { busy: true }), { kind: "ignore" });
  assert.deepEqual(pressed("", { leftArrow: true }), { kind: "edit", op: "left" });
  assert.deepEqual(pressed("", { rightArrow: true, meta: true }), { kind: "edit", op: "word-right" });
  assert.deepEqual(pressed("a", { ctrl: true }), { kind: "edit", op: "line-start" });
  assert.deepEqual(pressed("e", { ctrl: true }), { kind: "edit", op: "line-end" });
  assert.deepEqual(pressed("w", { ctrl: true }), { kind: "edit", op: "delete-word" });
  assert.deepEqual(pressed("", { backspace: true, meta: true }), { kind: "edit", op: "delete-word" });
  assert.deepEqual(pressed("", { return: true, meta: true }), { kind: "edit", op: "newline" });
  assert.deepEqual(pressed("", { return: true, shift: true }), { kind: "edit", op: "newline" });
  assert.deepEqual(pressed("", { return: true, shift: true }, { suggestions: true }), {
    kind: "edit",
    op: "newline",
  });
  assert.deepEqual(pressed("g", { ctrl: true }), { kind: "edit-external" });
  assert.deepEqual(pressed("", { tab: true }, { debug: true }), { kind: "debug-tab" });
  assert.deepEqual(pressed("", { tab: true }, { debug: true, switcher: true }), { kind: "ignore" });
  assert.deepEqual(pressed("b", { ctrl: true }), { kind: "ignore" });
});

test("F1 is the sequence Ink drops before the input handler", () => {
  assert.equal(isF1("\u001bOP"), true);
  assert.equal(isF1("\u001b[11~"), true);
  assert.equal(isF1("\u001b[[A"), true);
  assert.equal(isF1("\u001b[P"), true);
  assert.equal(isF1("a"), false);
  assert.equal(isF1("\u001b[A"), false);
});

test("the key list scrolls from the top", () => {
  assert.equal(moveOverlayOffset(0, "down", 40, 10), 9);
  assert.equal(moveOverlayOffset(9, "up", 40, 10), 0);
  assert.equal(moveOverlayOffset(0, "end", 40, 10), 30);
  assert.equal(moveOverlayOffset(30, "start", 40, 10), 0);
  assert.equal(moveOverlayOffset(0, "down", 4, 10), 0);
});
