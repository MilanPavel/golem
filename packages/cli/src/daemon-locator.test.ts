import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { DaemonNotFoundError, locateDaemon } from "./daemon-locator.ts";

const beside = (execPath: string): string =>
  path.resolve(path.dirname(execPath), "../libexec/golem-daemon/golem-daemon");

test("GOLEM_DAEMON wins when that file exists", () => {
  const found = locateDaemon({
    golemDaemon: "  /opt/golem/golem-daemon  ",
    execPath: "/usr/local/bin/golem",
    startDir: "/work",
    exists: (candidate) => candidate === "/opt/golem/golem-daemon",
    workspaceRoot: () => "/repo",
  });
  assert.deepEqual(found, { command: "/opt/golem/golem-daemon", args: [] });
});

test("a set GOLEM_DAEMON that is missing is an error, not a fallback", () => {
  assert.throws(
    () =>
      locateDaemon({
        golemDaemon: "/missing/golem-daemon",
        execPath: "/usr/local/bin/golem",
        startDir: "/work",
        exists: () => false,
        workspaceRoot: () => "/repo",
      }),
    (error: unknown) => {
      assert.ok(error instanceof DaemonNotFoundError);
      assert.deepEqual(error.tried, ["GOLEM_DAEMON=/missing/golem-daemon"]);
      return true;
    },
  );
});

test("the daemon beside the executable is next", () => {
  const execPath = "/Applications/golem/bin/golem";
  const found = locateDaemon({
    golemDaemon: "",
    execPath,
    startDir: "/work",
    exists: (candidate) => candidate === beside(execPath),
    workspaceRoot: () => "/repo",
  });
  assert.deepEqual(found, { command: beside(execPath), args: [] });
});

test("the checkout is last, through uv", () => {
  const found = locateDaemon({
    golemDaemon: undefined,
    execPath: "/usr/local/bin/node",
    startDir: "/repo/packages/cli/src",
    exists: () => false,
    workspaceRoot: () => "/repo",
  });
  assert.deepEqual(found, {
    command: "uv",
    args: ["run", "--project", "/repo", "python", "-m", "golem"],
  });
});

test("nothing found names every place that was tried", () => {
  const execPath = "/usr/local/bin/node";
  assert.throws(
    () =>
      locateDaemon({
        golemDaemon: undefined,
        execPath,
        startDir: "/tmp",
        exists: () => false,
        workspaceRoot: () => null,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DaemonNotFoundError);
      assert.deepEqual(error.tried, [beside(execPath), "checkout (uv run)"]);
      assert.match(error.message, /golem daemon not found/);
      return true;
    },
  );
});
