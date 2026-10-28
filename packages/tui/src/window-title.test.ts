import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLEAR_PROGRESS,
  CLEAR_TAB_STATUS,
  hasTabStatus,
  oscTabStatus,
  tabState,
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

test("the title leaves the mark out when the tab status shows the state", () => {
  assert.equal(windowTitle({ ...idle, phase: "thinking" }, false), "Trip (golem)");
  assert.equal(windowTitle({ ...idle, title: "untitled" }, false), "golem");
});

test("the tab state follows the same order as the mark", () => {
  assert.equal(tabState(idle), "idle");
  assert.equal(tabState({ ...idle, error: true }), "error");
  assert.equal(tabState({ ...idle, phase: "writing", error: true }), "working");
  assert.equal(tabState({ ...idle, phase: "waiting" }), "waiting");
  assert.equal(tabState({ ...idle, phase: "waiting", connection: "reconnecting" }), "offline");
});

test("only iTerm2 outside tmux gets the tab status", () => {
  assert.equal(hasTabStatus({ TERM_PROGRAM: "iTerm.app" }), true);
  assert.equal(hasTabStatus({ LC_TERMINAL: "iTerm2", TERM_PROGRAM: "tmux" }), false);
  assert.equal(hasTabStatus({ LC_TERMINAL: "iTerm2" }), true);
  assert.equal(hasTabStatus({ TERM_PROGRAM: "iTerm.app", TMUX: "/tmp/tmux-501/default,1,0" }), false);
  assert.equal(hasTabStatus({ TERM_PROGRAM: "Apple_Terminal" }), false);
});

test("the tab status is a dot and a word, and empty values clear it", () => {
  assert.equal(oscTabStatus("working"), "\u001b]21337;indicator=#ff9500;status=working;status-color=#ff9500\u0007");
  assert.equal(oscTabStatus("idle"), "\u001b]21337;indicator=#00d75f;status=idle;status-color=#888888\u0007");
  assert.equal(CLEAR_TAB_STATUS, "\u001b]21337;indicator=;status=;status-color=\u0007");
});
