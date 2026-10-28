import assert from "node:assert/strict";
import { test } from "node:test";

import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";

import { type Check, doctorExitCode, formatDoctor, parseChecks, runDoctor, runningCheck } from "./doctor.ts";

const DAEMON = { command: "/opt/homebrew/opt/golem/libexec/golem-daemon/golem-daemon", args: [] };

function status(version: string): DaemonStatus {
  return { pid: 42, version, protocol_major: 2, protocol_minor: 18, uptime_seconds: 5, state: "running" };
}

const FROM_DAEMON: Check[] = [
  { name: "service", status: "ok", detail: "launchd runs golem-daemon", fix: null },
  { name: "config", status: "ok", detail: "no config.toml, using the defaults", fix: null },
];

test("the running daemon goes right after the service that starts it", async () => {
  const asked: string[] = [];
  const checks = await runDoctor({
    cliVersion: "0.2.0",
    located: DAEMON,
    daemonChecks: async (daemon) => {
      asked.push(daemon.command);
      return FROM_DAEMON;
    },
    readStatus: async () => status("0.2.0"),
  });
  assert.deepEqual(
    checks.map((check) => [check.name, check.status]),
    [["daemon", "ok"], ["service", "ok"], ["running", "ok"], ["config", "ok"]],
  );
  assert.equal(checks[0]?.detail, DAEMON.command);
  assert.deepEqual(asked, [DAEMON.command]);
});

test("a checkout's daemon shows the uv command that runs it", async () => {
  const checks = await runDoctor({
    cliVersion: "0.0.0-dev",
    located: { command: "uv", args: ["run", "--project", "/src/golem", "python", "-m", "golem"] },
    daemonChecks: async () => [],
    readStatus: async () => null,
  });
  assert.equal(checks[0]?.detail, "uv run --project /src/golem python -m golem");
});

test("without a daemon executable, only what the CLI can see is checked", async () => {
  const checks = await runDoctor({
    cliVersion: "0.2.0",
    located: { error: "golem daemon not found. Tried:\n  /opt/homebrew/libexec/golem-daemon/golem-daemon" },
    daemonChecks: async () => assert.fail("there is no daemon to ask"),
    readStatus: async () => null,
  });
  assert.deepEqual(
    checks.map((check) => [check.name, check.status]),
    [["daemon", "fail"], ["running", "fail"]],
  );
  assert.equal(checks[0]?.fix, "brew reinstall golem, or set GOLEM_DAEMON to the daemon's path");
});

test("a daemon whose checks fail to run is one failed line", async () => {
  const checks = await runDoctor({
    cliVersion: "0.2.0",
    located: DAEMON,
    daemonChecks: async () => {
      throw new Error("ModuleNotFoundError: No module named 'httpx'");
    },
    readStatus: async () => status("0.2.0"),
  });
  assert.deepEqual(checks.at(-1), {
    name: "checks",
    status: "fail",
    detail: "its checks did not run: ModuleNotFoundError: No module named 'httpx'",
    fix: "golem daemon logs",
  });
});

test("the running daemon must answer, with the CLI's version", () => {
  assert.deepEqual(runningCheck("0.2.0", null), {
    name: "running",
    status: "fail",
    detail: "the daemon does not answer",
    fix: "golem daemon start",
  });
  assert.deepEqual(runningCheck("0.2.0", status("0.1.0")), {
    name: "running",
    status: "fail",
    detail: "the daemon is 0.1.0, this golem is 0.2.0",
    fix: "golem daemon restart",
  });
  assert.deepEqual(runningCheck("0.2.0", status("0.2.0")), {
    name: "running",
    status: "ok",
    detail: "version 0.2.0, pid 42",
  });
});

test("parseChecks takes the daemon's JSON and refuses anything else", () => {
  assert.deepEqual(parseChecks(JSON.stringify(FROM_DAEMON)), FROM_DAEMON);
  assert.throws(() => parseChecks("not json"), SyntaxError);
  assert.throws(() => parseChecks('{"name": "service"}'), /list of checks/);
  assert.throws(() => parseChecks('[{"name": "disk", "status": "bad", "detail": ""}]'), /list of checks/);
});

test("the checklist aligns details and shows a fix under each problem", () => {
  const checks: Check[] = [
    { name: "service", status: "ok", detail: "launchd runs golem-daemon", fix: null },
    { name: "ollama", status: "fail", detail: "Ollama is not installed", fix: "pick a local model in /model, and golem installs it, or brew install ollama" },
    { name: "model", status: "warn", detail: "no model chosen yet", fix: "open golem and pick one with /model" },
  ];
  assert.equal(
    formatDoctor(checks),
    [
      "✓ service  launchd runs golem-daemon",
      "✗ ollama   Ollama is not installed",
      "           fix: pick a local model in /model, and golem installs it, or brew install ollama",
      "! model    no model chosen yet",
      "           fix: open golem and pick one with /model",
      "",
      "1 problem, 1 warning.",
    ].join("\n"),
  );
  assert.equal(doctorExitCode(checks), 1);
});

test("a detail over several lines stays in its column", () => {
  const checks: Check[] = [{ name: "daemon", status: "fail", detail: "not found. Tried:\n  /a\n  /b", fix: "reinstall" }];
  assert.equal(
    formatDoctor(checks),
    ["✗ daemon  not found. Tried:", "            /a", "            /b", "          fix: reinstall", "", "1 problem."].join(
      "\n",
    ),
  );
});

test("warnings alone do not fail, and all ok says so", () => {
  const warned: Check[] = [{ name: "model", status: "warn", detail: "no model chosen yet" }];
  assert.equal(doctorExitCode(warned), 0);
  assert.match(formatDoctor(warned), /\n\n1 warning\.$/);
  const fine: Check[] = [{ name: "disk", status: "ok", detail: "50.0 GB free" }];
  assert.equal(formatDoctor(fine), "✓ disk  50.0 GB free\n\nEverything looks good.");
  assert.equal(doctorExitCode(fine), 0);
});
