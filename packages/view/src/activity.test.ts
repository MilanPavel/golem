import assert from "node:assert/strict";
import { test } from "node:test";

import { displayToolName, isDetail, stepCount, stepMark, summarizeSteps } from "./activity.ts";
import type { ToolBlock } from "./chat-state.ts";

const tool = (name: string, over: Partial<ToolBlock> = {}): ToolBlock => ({ callId: name, name, args: {}, status: "done", ...over });

test("an MCP tool name reads as server · tool, other names stay", () => {
  assert.equal(displayToolName("mcp__github__get_me"), "github · get_me");
  assert.equal(displayToolName("mcp__my_server__list__all"), "my_server · list__all");
  assert.equal(displayToolName("read_file"), "read_file");
});

test("the summary groups by kind in order of first use", () => {
  const tools = [
    tool("web_search"),
    tool("read_file"),
    tool("read_file"),
    tool("read_file"),
    tool("mcp__GitHub__get_me"),
    tool("mcp__GitHub__list", { status: "failed" }),
    tool("mcp__GitHub__list"),
    tool("shell"),
    tool("shell", { approval: { source: "x", subject: null } }),
  ];
  assert.equal(summarizeSteps(tools), "searched the web · read 3 files · 3 GitHub calls, 1 failed · ran 2 commands · 1 approval");
});

test("each kind has its words, and one reads in the singular", () => {
  assert.equal(summarizeSteps([tool("web_fetch")]), "fetched 1 page");
  assert.equal(summarizeSteps([tool("web_fetch"), tool("web_fetch")]), "fetched 2 pages");
  assert.equal(summarizeSteps([tool("grep"), tool("glob"), tool("list_dir")]), "searched files");
  assert.equal(summarizeSteps([tool("edit_file"), tool("write_file")]), "edited 2 files");
  assert.equal(summarizeSteps([tool("mystery"), tool("other")]), "2 tools");
  assert.equal(summarizeSteps([tool("mcp__github__a")]), "1 github call");
  assert.equal(summarizeSteps([]), "");
});

test("an unsuccessful or denied call counts as failed", () => {
  assert.equal(summarizeSteps([tool("shell", { unsuccessful: true }), tool("shell", { status: "failed" })]), "ran 2 commands, 2 failed");
});

test("a dot per tool: done, failed, waiting, running", () => {
  assert.equal(stepMark(tool("a")), "allow");
  assert.equal(stepMark(tool("a", { unsuccessful: true })), "deny");
  assert.equal(stepMark(tool("a", { status: "failed" })), "deny");
  assert.equal(stepMark(tool("a", { status: "waiting" })), "wait");
  assert.equal(stepMark(tool("a", { status: "running" })), "run");
  assert.equal(stepMark(tool("a", { status: "requested" })), "run");
});

test("steps count and detail names", () => {
  assert.equal(stepCount(1), "1 step");
  assert.equal(stepCount(5), "5 steps");
  assert.equal(isDetail("quiet"), true);
  assert.equal(isDetail("loud"), false);
  assert.equal(isDetail(null), false);
});
