import assert from "node:assert/strict";
import { test } from "node:test";

import { oscWindowTitle, RESTORE_WINDOW_TITLE, SAVE_WINDOW_TITLE, windowTitle } from "./window-title.ts";

test("the terminal title is the session name", () => {
  assert.equal(windowTitle("untitled"), "golem \u2014 untitled");
  assert.equal(windowTitle("Trip"), "golem \u2014 Trip");
});

test("the title sequence cannot close itself", () => {
  assert.equal(oscWindowTitle("a\u001bb\u0007c"), "\u001b]0;abc\u0007");
  assert.equal(SAVE_WINDOW_TITLE, "\u001b[22;0t");
  assert.equal(RESTORE_WINDOW_TITLE, "\u001b[23;0t");
});
