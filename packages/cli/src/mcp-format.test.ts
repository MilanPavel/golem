import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer } from "../../protocol/gen/mcp-list-result.ts";
import type { McpServerDetail } from "../../protocol/gen/mcp-server-detail.ts";

import {
  changeToolFilter,
  formatLogLine,
  formatMcpDetail,
  formatMcpList,
  formatMcpTools,
  formatTestResult,
  formatTestStep,
  ownToolName,
  serverMarks,
} from "./mcp-format.ts";

const SERVER: McpServer = { name: "git", state: "running", command: "uvx mcp-server-git", tools: ["mcp__git__status"] };

test("the list says how each server is turned on and what limits it", () => {
  const text = formatMcpList([
    { ...SERVER, schema_tokens: 120 },
    { name: "web", state: "idle", command: "npx x", tools: [], on_demand: true, tools_hidden: 2, approval: "allow" },
    { name: "bad", state: "failed", command: "nope", tools: [], error: "not found" },
  ]);
  const lines = text.split("\n");
  assert.match(lines[0] ?? "", /^NAME +STATE +TOOLS +TOKENS +NOTES$/);
  assert.match(lines[1] ?? "", /^git +running +1 +120$/);
  assert.match(lines[2] ?? "", /^web +idle +0 +- +on demand, hidden 2 tools, allow$/);
  assert.match(lines[3] ?? "", /^bad +failed .*not found$/);
  assert.deepEqual(serverMarks({ ...SERVER, on_demand: true }), ["on demand"]);
  assert.match(formatMcpList([]), /golem mcp add --catalog/);
});

test("show names each secret and says whether it is stored, never what it is", () => {
  const detail = {
    server: { ...SERVER, state: "failed", error: "token rejected" },
    config: {
      command: "npx",
      args: ["-y", "x"],
      env: { TOKEN: "keychain:mcp/git" },
      enabled: "on_demand",
      timeout_seconds: 30,
      approval: "allow",
      tools: { include: [], exclude: ["drop_*"] },
    },
    scope: "user",
    path: "/h/config.toml",
    secrets: [
      { ref: "mcp/git", stored: false },
      { ref: "mcp/git-two", stored: true },
    ],
  } as unknown as McpServerDetail;
  const text = formatMcpDetail(detail);
  assert.match(text, /^git {2}failed {2}token rejected/);
  assert.match(text, /in \/h\/config.toml \(user\)/);
  assert.match(text, /command npx -y x/);
  assert.match(text, /TOKEN = keychain:mcp\/git/);
  assert.match(text, /on demand · 30s per call · approval allow/);
  assert.match(text, /tools hidden drop_\*/);
  assert.match(text, /secret mcp\/git: not stored: golem auth set mcp\/git/);
  assert.match(text, /secret mcp\/git-two: stored$/);
});

test("a test prints each step as it ends, then what it found or why it failed", () => {
  assert.equal(formatTestStep({ test_id: "t", step: "spawn", state: "running" }), null);
  assert.equal(formatTestStep({ test_id: "t", step: "resolve", state: "ok", elapsed_ms: 4 }), "✓ resolve 0m 00.004s");
  assert.equal(
    formatTestStep({ test_id: "t", step: "spawn", state: "failed", elapsed_ms: 9, detail: "no such file" }),
    "✗ spawn 0m 00.009s  no such file",
  );
  assert.equal(formatTestStep({ test_id: "t", step: "ping", state: "skipped" }), "- ping");
  const ok = formatTestResult({
    test_id: "t",
    ok: true,
    steps: [],
    server_info: { name: "git", version: "1.2" },
    tools: [{ name: "a", description: "", hidden: false, schema_tokens: 1 }],
  });
  assert.equal(ok, "ok: git 1.2, 1 tools");
  const bad = formatTestResult({ test_id: "t", ok: false, steps: [], stderr_tail: ["boom"], hint: "Install Node: brew install node" });
  assert.equal(bad, "failed\nthe server said:\n  boom\nInstall Node: brew install node");
});

test("a log line has a time, its kind, and its text", () => {
  assert.match(formatLogLine({ ts: 1_700_000_000, kind: "stderr", text: "hi" }), /^\d\d:\d\d:\d\d stderr hi$/);
  assert.match(formatLogLine({ ts: 1_700_000_000, kind: "event", text: "restarted" }), /^\d\d:\d\d:\d\d event {2}restarted$/);
});

test("tools show the server's own names, with cost and which are hidden", () => {
  assert.equal(ownToolName("git", "mcp__git__status"), "status");
  assert.equal(ownToolName("git", "other"), "other");
  const text = formatMcpTools({
    name: "git",
    tools: [
      { name: "mcp__git__status", description: "", hidden: false, schema_tokens: 40 },
      { name: "mcp__git__push", description: "", hidden: true, schema_tokens: 55 },
    ],
  });
  assert.match(text, /status +40/);
  assert.match(text, /push +55 +hidden/);
  assert.match(formatMcpTools({ name: "git", tools: [] }), /not running/);
});

test("hiding adds a pattern once, and showing takes one out or says what is hidden", () => {
  const base = { command: "uvx", tools: { include: ["a"], exclude: ["x_*"] } };
  const hidden = changeToolFilter(base, ["y", "x_*"], []);
  assert.deepEqual(hidden.ok && hidden.config.tools, { include: ["a"], exclude: ["x_*", "y"] });
  const shown = changeToolFilter(base, [], ["x_*"]);
  assert.deepEqual(shown.ok && shown.config.tools, { include: ["a"], exclude: [] });
  const missing = changeToolFilter(base, [], ["z"]);
  assert.equal(missing.ok, false);
  assert.match(!missing.ok ? missing.message : "", /z is not a hidden pattern \(hidden patterns: x_\*\)/);
  assert.match(!changeToolFilter({ command: "uvx" }, [], ["z"]).ok ? "nothing is hidden" : "", /nothing is hidden/);
});
