import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer } from "@golem/client";

import { detailChoices, mcpAlert, mcpStatusMark, mcpStatusWord, mcpSummary, mergeMcp, orderedServers, shortPath } from "./mcp-servers.ts";

const git: McpServer = {
  name: "git",
  state: "running",
  command: "mcp-server-git",
  tools: ["mcp__git__a", "mcp__git__b"],
  schema_tokens: 1300,
  on_demand: false,
  enabled: null,
};
const down: McpServer = { ...git, name: "down", state: "failed", error: "exited", retry_seconds: 4.2, tools: [] };
const lazy: McpServer = { ...git, name: "lazy", state: "idle", tools: [], schema_tokens: null, on_demand: true, enabled: false };
const project: McpServer = { ...git, name: "db", project: "/work/app" };

test("a row says tools and tokens, or the error and when it retries, or how it is turned on", () => {
  assert.equal(mcpSummary(git), "2 tools · 1.3K tokens");
  assert.equal(mcpSummary({ ...git, tools_hidden: 1, approval: "allow" }), "2 tools · 1.3K tokens · 1 hidden · allow");
  assert.equal(mcpSummary({ ...git, approval: "read-only" }), "2 tools · 1.3K tokens · read-only");
  assert.equal(mcpSummary({ ...git, tools: ["x"], schema_tokens: 40, on_demand: true, enabled: true }), "1 tool · 40 tokens · on in this chat");
  assert.equal(mcpSummary(down), "exited · retry in 4s");
  assert.equal(mcpSummary(lazy), "on demand · off in this chat");
  assert.equal(mcpSummary(lazy, false), "on demand");
  assert.equal(mcpSummary({ ...git, state: "disabled" }), "disabled");
  assert.equal(mcpSummary({ ...git, state: "starting" }), "starting…");
});

test("each state has a glyph, a tone, and a word", () => {
  assert.deepEqual(mcpStatusMark(git), { text: "✔", tone: "ok" });
  assert.deepEqual(mcpStatusMark(down), { text: "✘", tone: "bad" });
  assert.deepEqual(mcpStatusMark({ ...git, state: "starting" }), { text: "◌", tone: "wait" });
  assert.deepEqual(mcpStatusMark(lazy), { text: "○", tone: "off" });
  assert.deepEqual(mcpStatusMark({ ...git, state: "disabled" }), { text: "–", tone: "off" });
  assert.equal(mcpStatusWord(lazy), "on demand");
  assert.equal(mcpStatusWord(git), "running");
});

test("the user's servers come before the project's", () => {
  assert.deepEqual(orderedServers([project, git, down]).map((server) => server.name), ["git", "down", "db"]);
});

test("the choices fit the state, and a project's server is not removed from here", () => {
  const labels = (server: McpServer) => detailChoices(server).map((choice) => choice.label);
  assert.deepEqual(labels(lazy), ["Turn on for this chat", "Start", "Disable everywhere", "Test the connection", "View the log", "Remove"]);
  assert.deepEqual(labels({ ...git, state: "disabled" }).slice(0, 2), ["Enable for every chat", "Enable on demand"]);
  assert.ok(labels(git).includes("View tools"));
  assert.ok(labels(git).includes("Reconnect"));
  assert.ok(!labels({ ...git, state: "disabled" }).some((label) => label === "Reconnect" || label === "Start"));
  assert.ok(!labels(project).includes("Remove"));
});

test("a pushed status keeps whether this session has the server on, and the alert names the ones that are down", () => {
  const merged = mergeMcp([{ ...lazy, enabled: true }, git], { ...lazy, state: "running", enabled: null });
  assert.equal(merged[0]?.state, "running");
  assert.equal(merged[0]?.enabled, true);
  assert.equal(mcpAlert([{ ...down, enabled: true }, git]), "mcp ✗ down");
  assert.equal(mcpAlert([down]), "");
  assert.equal(mcpAlert(null), "");
});

test("a path under home shows with ~, and one outside is as sent", () => {
  assert.equal(shortPath("/Users/me/.golem/config.toml", "/Users/me"), "~/.golem/config.toml");
  assert.equal(shortPath("/Users/me/.golem/config.toml", ""), "/Users/me/.golem/config.toml");
});
