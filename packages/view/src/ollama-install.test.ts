import assert from "node:assert/strict";
import { test } from "node:test";

import { appendInstallOutput, installEventOf } from "./ollama-install.ts";

test("the daemon's output and its end become events", () => {
  assert.deepEqual(installEventOf({ kind: "output", text: "==> Pouring\n" }), { kind: "output", text: "==> Pouring\n" });
  assert.deepEqual(installEventOf({ kind: "done", done: { outcome: "installed" } }), {
    kind: "exit",
    code: 0,
    stopped: false,
  });
  assert.deepEqual(installEventOf({ kind: "done", done: { outcome: "stopped" } }), {
    kind: "exit",
    code: null,
    stopped: true,
  });
  assert.deepEqual(installEventOf({ kind: "done", done: { outcome: "failed", reason: "code 1: Error: no space" } }), {
    kind: "error",
    message: "code 1: Error: no space",
  });
  assert.deepEqual(installEventOf({ kind: "done", done: { outcome: "failed" } }), {
    kind: "error",
    message: "brew install ollama failed",
  });
});

test("the tail keeps the newest finished line, and the text after it", () => {
  const first = appendInstallOutput({ last: "", partial: "" }, "==> Downloading\nPour");
  assert.deepEqual(first, { last: "==> Downloading", partial: "Pour" });
  const second = appendInstallOutput(first, "ing\n\n");
  assert.deepEqual(second, { last: "Pouring", partial: "" });
  // A redrawn line keeps what was drawn last.
  assert.equal(appendInstallOutput(second, "10%\r50%\r100%\n").last, "100%");
});
