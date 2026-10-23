import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer } from "@golem/client";

import { mcpAlert, mergeMcp } from "./mcp.ts";

const git: McpServer = {
  name: "git",
  state: "running",
  command: "uvx mcp-server-git",
  tools: ["mcp__git__git_status", "mcp__git__git_log"],
  schema_tokens: 1840,
  enabled: true,
};
const github: McpServer = {
  name: "github",
  state: "failed",
  command: "https://api.example.com/mcp",
  error: "HTTP 401: bad token",
  retry_seconds: 4,
  enabled: true,
};
const lazy: McpServer = { name: "lazy", state: "idle", command: "npx lazy", on_demand: true, enabled: false };

test("a status update replaces its server, keeps whether it is on here, and adds nothing", () => {
  const failed: McpServer = { ...git, state: "failed", tools: [], error: "exited", enabled: null };
  assert.deepEqual(mergeMcp([git, github], failed), [{ ...failed, enabled: true }, github]);
  const elsewhere: McpServer = { ...git, project: "/other" };
  assert.deepEqual(mergeMcp([git], elsewhere), [git]);
  assert.deepEqual(mergeMcp([github], lazy), [github]);
});

test("the status line names the servers this session uses that are down", () => {
  assert.equal(mcpAlert(null), "");
  assert.equal(mcpAlert([git, lazy]), "");
  assert.equal(mcpAlert([git, github, { ...github, name: "web" }]), "mcp ✗ github, web");
  assert.equal(mcpAlert([{ ...github, enabled: false }]), "");
});
