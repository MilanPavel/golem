import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INSTALL_BAND_ROWS,
  INSTALL_KEPT_LINES,
  type InstallState,
  installEventOf,
  installLines,
  installRows,
  OLLAMA_DOWNLOAD,
  reduceInstall,
  startedInstall,
} from "./ollama-install.ts";

function output(state: InstallState, ...texts: string[]): InstallState {
  return texts.reduce((next, text) => reduceInstall(next, { kind: "output", text }), state);
}

test("output becomes lines, without colours, and a redrawn line keeps its newest text", () => {
  const state = output(startedInstall, "==> Fetching \u001b[32mollama\u001b[0m\n##   10%\r####  50", "%\r###### 100%\n", "==> Pour");
  assert.deepEqual(state, {
    phase: "running",
    lines: ["==> Fetching ollama", "###### 100%"],
    partial: "==> Pour",
  });
  const done = reduceInstall(state, { kind: "exit", code: 0, stopped: false });
  assert.deepEqual(done, { phase: "done", lines: ["==> Fetching ollama", "###### 100%", "==> Pour"] });
});

test("escapes other than colours are shown, not run", () => {
  const state = output(startedInstall, "bad \u0007bell \u001b]52;c;aGk=\u0007 clipboard\n");
  assert.ok(state.phase === "running");
  assert.deepEqual(state.lines, ["bad �bell  clipboard"]);
});

test("only the newest lines are kept", () => {
  const many = Array.from({ length: INSTALL_KEPT_LINES + 5 }, (_, index) => `line ${index}\n`).join("");
  const state = output(startedInstall, many);
  assert.ok(state.phase === "running");
  assert.equal(state.lines.length, INSTALL_KEPT_LINES);
  assert.equal(state.lines[0], "line 5");
});

test("an exit says how the install ended, and later events change nothing", () => {
  const failed = reduceInstall(output(startedInstall, "Error: no bottle\n"), { kind: "exit", code: 1, stopped: false });
  assert.deepEqual(failed, {
    phase: "failed",
    lines: ["Error: no bottle"],
    reason: "brew install ollama exited with code 1",
  });
  assert.equal(reduceInstall(failed, { kind: "output", text: "late\n" }), failed);

  const stopped = reduceInstall(startedInstall, { kind: "exit", code: 143, stopped: true });
  assert.deepEqual(stopped, { phase: "stopped", lines: [] });

  const broken = reduceInstall(startedInstall, { kind: "error", message: "spawn brew EACCES" });
  assert.deepEqual(broken, { phase: "failed", lines: [], reason: "spawn brew EACCES" });
});

test("the band shows the title and the newest output that fits", () => {
  const state = output(startedInstall, "one\ntwo\nthree\nfou");
  assert.deepEqual(installLines(state, 80, 3), [
    { text: "Installing Ollama with Homebrew · Esc stops", tone: "title" },
    { text: "three", tone: "output" },
    { text: "fou", tone: "output" },
  ]);
  assert.deepEqual(installLines(state, 12, 1), [{ text: "Installing…", tone: "title" }]);
  assert.deepEqual(installLines(state, 80, 0), []);
});

test("a failed install keeps its last output and offers /model", () => {
  const failed: InstallState = { phase: "failed", lines: ["a", "b", "Error: no bottle"], reason: "brew install ollama exited with code 1" };
  assert.deepEqual(installLines(failed, 80, 3), [
    { text: "Ollama was not installed: brew install ollama exited with code 1", tone: "error" },
    { text: "Error: no bottle", tone: "output" },
    { text: "/model to switch to a hosted model", tone: "hint" },
  ]);
});

test("without Homebrew the band links the download and runs nothing", () => {
  assert.deepEqual(installLines({ phase: "no_brew" }, 100, 4), [
    { text: `Homebrew isn't installed. Download Ollama from ${OLLAMA_DOWNLOAD}`, tone: "error" },
    { text: "/model to switch to a hosted model", tone: "hint" },
  ]);
});

test("the daemon's end reaches the band's reducer", () => {
  const done = reduceInstall(startedInstall, installEventOf({ kind: "done", done: { outcome: "installed" } }));
  assert.equal(done.phase, "done");
});

test("the band is tall while brew runs or after it failed, and short otherwise", () => {
  assert.equal(installRows(startedInstall), INSTALL_BAND_ROWS);
  assert.equal(installRows({ phase: "failed", lines: ["Error"], reason: "x" }), 3);
  assert.equal(installRows({ phase: "failed", lines: Array.from({ length: 9 }, () => "e"), reason: "x" }), INSTALL_BAND_ROWS);
  assert.equal(installRows({ phase: "no_brew" }), 2);
  assert.equal(installRows({ phase: "stopped", lines: [] }), 1);
});
