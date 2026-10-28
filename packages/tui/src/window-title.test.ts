import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLEAR_PROGRESS,
  oscProgress,
  oscWindowTitle,
  RESTORE_WINDOW_TITLE,
  SAVE_WINDOW_TITLE,
  tabProgress,
  type TitleState,
  TITLE_SPINNER,
  titleMark,
  windowTitle,
} from "./window-title.ts";

const idle: TitleState = { title: "Trip", phase: null, error: false, connection: "connected", frame: 0 };

test("the terminal title is a mark, the session name, then golem", () => {
  assert.equal(windowTitle(idle), "✳ Trip (golem)");
  assert.equal(windowTitle({ ...idle, title: "untitled", error: true }), "✗ golem");
  assert.equal(windowTitle({ ...idle, title: "  " }), "✳ golem");
});

test("a working run spins once a second, and an approval shows !", () => {
  assert.equal(titleMark({ ...idle, phase: "thinking", frame: 0 }), TITLE_SPINNER[0]);
  assert.equal(titleMark({ ...idle, phase: "writing", frame: 1 }), TITLE_SPINNER[1]);
  assert.equal(titleMark({ ...idle, phase: "writing", frame: TITLE_SPINNER.length + 2 }), TITLE_SPINNER[2]);
  assert.equal(titleMark({ ...idle, phase: "waiting", frame: 3 }), "!");
});

test("without the daemon the mark says so, before anything else", () => {
  for (const connection of ["connecting", "reconnecting", "closed", "rejected"] as const) {
    assert.equal(titleMark({ ...idle, connection, phase: "waiting", error: true }), "○");
  }
  assert.equal(titleMark({ ...idle, phase: "thinking", error: true }), TITLE_SPINNER[0]);
});

test("the title sequence cannot close itself", () => {
  assert.equal(oscWindowTitle("a\u001bb\u0007c"), "\u001b]0;abc\u0007");
  assert.equal(SAVE_WINDOW_TITLE, "\u001b[22;0t");
  assert.equal(RESTORE_WINDOW_TITLE, "\u001b[23;0t");
});

test("the tab shows progress while a run works, paused for an approval, and none when idle", () => {
  assert.equal(tabProgress(null), "none");
  assert.equal(tabProgress("thinking"), "busy");
  assert.equal(tabProgress("writing"), "busy");
  assert.equal(tabProgress("waiting"), "paused");
  assert.equal(oscProgress("busy"), "\u001b]9;4;3\u0007");
  assert.equal(oscProgress("paused"), "\u001b]9;4;4;0\u0007");
  assert.equal(CLEAR_PROGRESS, "\u001b]9;4;0\u0007");
});
