import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer } from "@golem/client";

import { MCP_HINT, mcpLines, mergeMcp } from "./mcp.ts";

const git: McpServer = {
  name: "git",
  state: "running",
  command: "uvx mcp-server-git",
  tools: ["mcp__git__git_status", "mcp__git__git_log"],
  error: null,
};
const github: McpServer = { name: "github", state: "failed", command: "npx x", tools: [], error: "command not found: npx" };
const off: McpServer = { name: "fs", state: "disabled", command: "npx fs", tools: [], error: null };

test("each server is one row: name, state, then tools or why it failed", () => {
  assert.deepEqual(mcpLines({ servers: [git, github, off], error: null }, 80), [
    "git     running   2 tools · uvx mcp-server-git",
    "github  failed    command not found: npx",
    "fs      disabled  npx fs",
  ]);
  assert.deepEqual(mcpLines({ servers: [git], error: null }, 20), ["git  running  2 too…"]);
});

test("no servers says how to add one, and the wait and an error say so", () => {
  assert.deepEqual(mcpLines({ servers: [], error: null }, 200), ["No MCP servers.", MCP_HINT]);
  assert.deepEqual(mcpLines({ servers: null, error: null }, 80), ["MCP servers: asking the daemon…"]);
  assert.deepEqual(mcpLines({ servers: null, error: "daemon is not running" }, 80), [
    "MCP servers: daemon is not running",
  ]);
});

test("a status update replaces its server, or adds it", () => {
  const failed: McpServer = { ...git, state: "failed", tools: [], error: "exited" };
  assert.deepEqual(mergeMcp([git, github], failed), [failed, github]);
  assert.deepEqual(mergeMcp([github], git), [github, git]);
});
