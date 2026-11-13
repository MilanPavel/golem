import assert from "node:assert/strict";
import { test } from "node:test";

import { golemBlock, tildePath } from "./setup-golem.ts";
import { setupProblemState } from "./setup-window.ts";

test("the home folder is written as ~, and a path elsewhere is kept", () => {
  assert.equal(tildePath("/Users/ann/.golem/config.toml"), "~/.golem/config.toml");
  assert.equal(tildePath("/home/ann"), "~");
  assert.equal(tildePath("/opt/homebrew/bin/golem"), "/opt/homebrew/bin/golem");
});

test("no facts from the daemon is no block", () => {
  assert.equal(golemBlock({}), null);
});

test("the block names the install, the files and the jobs; only paths are copied", () => {
  const daemon = "/opt/homebrew/opt/golem/libexec/golem-daemon/golem-daemon";
  const block = golemBlock({
    install: { method: "homebrew", version: "0.13.1", binary: "/opt/homebrew/bin/golem", daemon_binary: daemon },
    paths: {
      home: "/Users/ann/.golem",
      config: "/Users/ann/.golem/config.toml",
      logs: "/Users/ann/.golem/logs/golem.jsonl",
      socket: "/Users/ann/.golem/run/golem.sock",
    },
    jobs: [
      { label: "dev.golem.daemon", plist: "/Users/ann/Library/LaunchAgents/dev.golem.daemon.plist", loaded: true, pid: 4821 },
      { label: "dev.golem.web", plist: "/Users/ann/Library/LaunchAgents/dev.golem.web.plist", loaded: false },
    ],
  });
  assert.ok(block);
  assert.equal(block.version, "0.13.1");
  assert.deepEqual(
    block.facts.map((fact) => [fact.label, fact.value, fact.copy]),
    [
      ["Installed", "Homebrew · /opt/homebrew/bin/golem", "/opt/homebrew/bin/golem"],
      ["Daemon", daemon, daemon],
      ["Data", "~/.golem", "/Users/ann/.golem"],
      ["Config", "~/.golem/config.toml", "/Users/ann/.golem/config.toml"],
      ["Logs", "~/.golem/logs/golem.jsonl", "/Users/ann/.golem/logs/golem.jsonl"],
      ["Socket", "~/.golem/run/golem.sock", "/Users/ann/.golem/run/golem.sock"],
      ["Job", "dev.golem.daemon · pid 4821", null],
      ["Job", "dev.golem.web · not loaded", null],
    ],
  );
});

test("a golem that is not on the PATH has nothing to copy", () => {
  const block = golemBlock({ install: { method: "dev", version: "0.0.0-dev", daemon_binary: "/repo/.venv/bin/python" } });
  assert.equal(block?.facts[0]?.value, "Dev checkout · golem is not on the PATH");
  assert.equal(block?.facts[0]?.copy, null);
});

test("the header's mark is the first problem's state", () => {
  const ok = { part: "disk", name: "disk", state: "ok", detail: "" } as const;
  assert.equal(setupProblemState([ok]), "ok");
  assert.equal(setupProblemState([ok, { ...ok, part: "engine", state: "fail" }]), "fail");
  assert.equal(setupProblemState([{ ...ok, part: "service", state: "warn" }]), "ok");
});
