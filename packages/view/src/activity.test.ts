import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalQuestion, displayToolName, isDetail, stepCount, stepMark, summarizeSteps, writingLabel } from "./activity.ts";
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

test("approvalQuestion says an mcp_enable approval also covers the server's tools", () => {
  assert.equal(approvalQuestion("mcp_enable", { name: "playwright", reason: "r" }), "Turn on playwright and let it use its tools in this chat?");
  assert.equal(approvalQuestion("mcp_enable", {}), null);
  assert.equal(approvalQuestion("shell", { name: "x" }), null);
});

test("writingLabel names the file, the lines and the seconds", () => {
  assert.equal(writingLabel({ name: "write_file", path: "tests/test_fetch.py", lines: 14, chars: 400 }, 38), "writing tests/test_fetch.py · 14 lines · 38 s");
  assert.equal(writingLabel({ name: "write_file", path: null, lines: 14, chars: 400 }, 38), "writing a file · 14 lines · 38 s");
  assert.equal(writingLabel({ name: "write_file", path: null, lines: 1, chars: 4 }, 0), "writing a file · 1 line · 0 s");
  assert.equal(writingLabel({ name: "edit_file", path: "src/fetch.py", lines: 6, chars: 90 }, 4), "editing src/fetch.py · 6 lines · 4 s");
  assert.equal(writingLabel({ name: "edit_file", path: null, lines: 6, chars: 90 }, 4.7), "editing a file · 6 lines · 4 s");
});
