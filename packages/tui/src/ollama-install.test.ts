import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  findBrew,
  INSTALL_KEPT_LINES,
  type InstallEvent,
  type InstallProcess,
  type InstallState,
  installLines,
  OLLAMA_DOWNLOAD,
  reduceInstall,
  runInstall,
  startedInstall,
} from "./ollama-install.ts";

function output(state: InstallState, ...texts: string[]): InstallState {
  return texts.reduce((next, text) => reduceInstall(next, { kind: "output", text }), state);
}

class FakeBrew extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed: string[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.killed.push(signal ?? "SIGTERM");
    return true;
  }
}

test("brew is found on PATH first, then where Homebrew installs it", () => {
  const has = (files: string[]) => (file: string) => files.includes(file);
  assert.equal(findBrew("/usr/bin:/Users/me/brew/bin", has(["/Users/me/brew/bin/brew"])), "/Users/me/brew/bin/brew");
  assert.equal(findBrew("/usr/bin", has(["/opt/homebrew/bin/brew", "/usr/local/bin/brew"])), "/opt/homebrew/bin/brew");
  assert.equal(findBrew(undefined, has(["/usr/local/bin/brew"])), "/usr/local/bin/brew");
  assert.equal(findBrew("/usr/bin", has([])), null);
});

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

test("runInstall streams both outputs, then one exit", () => {
  const brew = new FakeBrew();
  const events: InstallEvent[] = [];
  const calls: { command: string; args: string[]; hints: string | undefined }[] = [];
  runInstall("/opt/homebrew/bin/brew", (event) => events.push(event), {
    env: { PATH: "/usr/bin" },
    spawn: (command, args, env) => {
      calls.push({ command, args, hints: env.HOMEBREW_NO_ENV_HINTS });
      return brew as unknown as InstallProcess;
    },
  });
  brew.stdout.emit("data", Buffer.from("==> Pouring\n"));
  brew.stderr.emit("data", "Warning: x\n");
  brew.emit("close", 0);
  brew.emit("close", 0);
  assert.deepEqual(calls, [{ command: "/opt/homebrew/bin/brew", args: ["install", "ollama"], hints: "1" }]);
  assert.deepEqual(events, [
    { kind: "output", text: "==> Pouring\n" },
    { kind: "output", text: "Warning: x\n" },
    { kind: "exit", code: 0, stopped: false },
  ]);
});

test("stop sends SIGTERM once, and the exit says it was stopped", () => {
  const brew = new FakeBrew();
  const events: InstallEvent[] = [];
  const run = runInstall("brew", (event) => events.push(event), { spawn: () => brew as unknown as InstallProcess });
  run.stop();
  run.stop();
  brew.emit("close", 143);
  run.stop();
  assert.deepEqual(brew.killed, ["SIGTERM"]);
  assert.deepEqual(events, [{ kind: "exit", code: 143, stopped: true }]);
});

test("a brew that cannot start fails with the reason", () => {
  const events: InstallEvent[] = [];
  runInstall("brew", (event) => events.push(event), {
    spawn: () => {
      throw new Error("spawn brew ENOENT");
    },
  });
  const brew = new FakeBrew();
  runInstall("brew", (event) => events.push(event), { spawn: () => brew as unknown as InstallProcess });
  brew.emit("error", new Error("spawn brew EACCES"));
  brew.emit("close", null);
  assert.deepEqual(events, [
    { kind: "error", message: "spawn brew ENOENT" },
    { kind: "error", message: "spawn brew EACCES" },
  ]);
});
