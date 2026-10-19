import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatMessage } from "./chat-state.ts";
import { gutterColumn, INTERRUPTED_MARK, layoutMessages, layoutTranscript, toolLabel, type Span } from "./layout-chat.ts";

function textOf(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join("");
}

function message(id: string, role: ChatMessage["role"], text: string, streaming = false): ChatMessage {
  return { id, role, text, streaming };
}

test("a short transcript is kept whole and has no gutter", () => {
  const fitted = layoutTranscript([message("1", "user", "hello")], 40, 12, 0);
  assert.equal(fitted.overflow, false);
  assert.equal(fitted.offsetFromBottom, 0);
  assert.equal(fitted.gutter, null);
  assert.match(fitted.lines.map((line) => textOf(line.spans)).join("\n"), /hello/);
});

test("overflow keeps the tail until the offset moves toward the start", () => {
  const messages: ChatMessage[] = [];
  for (let index = 0; index < 8; index += 1) {
    messages.push(message(String(index), "user", `line ${index}`));
  }
  const tail = layoutTranscript(messages, 40, 4, 0);
  assert.equal(tail.lines.length, 4);
  assert.equal(tail.overflow, true);
  assert.ok(tail.gutter);
  const rendered = tail.lines.map((line) => textOf(line.spans)).join("\n");
  assert.match(rendered, /line 7/);
  assert.doesNotMatch(rendered, /line 0/);
  assert.equal(tail.gutter.at(-1), "█");

  const head = layoutTranscript(messages, 40, 4, 1_000);
  assert.equal(head.offsetFromBottom > 0, true);
  assert.match(head.lines.map((line) => textOf(line.spans)).join("\n"), /line 0/);
  assert.equal(head.gutter?.[0], "█");
});

test("a shorter window keeps the same line at the bottom", () => {
  const messages: ChatMessage[] = [];
  for (let index = 0; index < 8; index += 1) {
    messages.push(message(String(index), "user", `line ${index}`));
  }
  const tail = layoutTranscript(messages, 40, 6, 0);
  const squeezed = layoutTranscript(messages, 40, 4, 0);
  assert.equal(squeezed.offsetFromBottom, 0);
  assert.equal(textOf(squeezed.lines.at(-1)?.spans ?? []), textOf(tail.lines.at(-1)?.spans ?? []));

  const scrolled = layoutTranscript(messages, 40, 6, 5);
  const still = layoutTranscript(messages, 40, 4, scrolled.offsetFromBottom);
  assert.equal(still.offsetFromBottom, scrolled.offsetFromBottom);
  assert.equal(textOf(still.lines.at(-1)?.spans ?? []), textOf(scrolled.lines.at(-1)?.spans ?? []));
});

test("user lines fill the content width and assistant lines do not", () => {
  const lines = layoutMessages(
    [message("u", "user", "hi"), message("a", "assistant", "ok")],
    10,
  );
  const user = lines.filter((line) => line.role === "user");
  const assistant = lines.filter((line) => line.role === "assistant");
  assert.ok(user.length > 0);
  assert.ok(user.every((line) => textOf(line.spans).length === 10));
  assert.ok(assistant.every((line) => textOf(line.spans).length < 10));
});

test("the gutter column is subtracted only when the transcript overflows", () => {
  const messages = [message("u", "user", "hi"), message("a", "assistant", "there")];
  const fitted = layoutTranscript(messages, 20, 1, 0);
  assert.equal(fitted.overflow, true);
  assert.ok(fitted.lines.every((line) => textOf(line.spans).length <= 19));
});

test("completed messages render markdown and streaming stays plain", () => {
  const completed = layoutMessages(
    [message("a", "assistant", "Hello **world**\n\n- one\n\n```\ncode\n```")],
    80,
  );
  const spans = completed.flatMap((line) => line.spans);
  assert.ok(spans.some((span) => span.text === "world" && span.bold === true));
  assert.ok(spans.some((span) => span.text === "code" && span.code === true));
  assert.ok(completed.some((line) => line.spans[0]?.text === "- "));

  const streaming = layoutMessages([message("a", "assistant", "**bold**", true)], 80);
  assert.equal(streaming[1]?.spans[0]?.text, "**bold**");
  assert.equal(streaming[1]?.spans[0]?.bold, undefined);
});

test("the thumb sits on the last row when the view follows the tail", () => {
  const gutter = gutterColumn(10, 4, 0);
  assert.deepEqual(gutter, ["│", "│", "│", "█"]);
  assert.equal(gutterColumn(10, 4, 6)[0], "█");
});

test("an interrupted reply ends with a mark", () => {
  const lines = layoutMessages([{ ...message("a", "assistant", "Hel"), interrupted: true }], 80);
  const last = lines.at(-1);
  assert.equal(last?.spans[0]?.text.trimEnd(), INTERRUPTED_MARK);
  assert.equal(last?.spans[0]?.italic, true);
});

test("a finished answer shows how long it took, and times sit beside the label", () => {
  const now = new Date(2026, 9, 17, 18, 0, 0).getTime();
  const at = new Date(2026, 9, 17, 14, 2, 0).toISOString();
  const lines = layoutMessages(
    [
      { ...message("u", "user", "hello"), at },
      { ...message("a", "assistant", "ok"), at, durationMs: 12_400 },
      { ...message("s", "assistant", "still", true), at, durationMs: 12_400 },
    ],
    80,
    { times: true, now },
  );
  const user = lines.find((line) => line.role === "user");
  assert.equal(user?.spans[0]?.text, "you");
  assert.equal(user?.spans[1]?.text, "  14:02");
  assert.equal(user?.spans[1]?.dim, true);
  const assistant = lines.filter((line) => line.role === "assistant");
  assert.equal(assistant.some((line) => line.spans[0]?.text === "12.4s" && line.spans[0]?.dim === true), true);
  const streaming = assistant.find((line) => line.spans.some((span) => span.text === "golem"));
  assert.equal(streaming?.spans[1]?.text, "  14:02");
  assert.equal(
    assistant.filter((line) => line.spans[0]?.text === "12.4s").length,
    1,
  );
});

test("tool calls are one line each, with output only while expanded", () => {
  const reply: ChatMessage = {
    ...message("a", "assistant", ""),
    tools: [
      {
        callId: "c1",
        name: "read_file",
        args: { path: "src/a.ts" },
        status: "done",
        summary: "2 lines",
        preview: "     1|one\n     2|two",
      },
      { callId: "c2", name: "grep", args: { pattern: "x" }, status: "failed", error: "bad regex" },
      { callId: "c3", name: "list_dir", args: {}, status: "running" },
    ],
  };
  const collapsed = layoutMessages([reply], 60).map((line) => textOf(line.spans));
  assert.deepEqual(collapsed, [
    "golem",
    "read_file src/a.ts ✓  2 lines",
    "grep x ✗  bad regex",
    "list_dir …",
  ]);
  const expanded = layoutMessages([reply], 60, { times: false, now: 0, toolOutput: true }).map((line) =>
    textOf(line.spans),
  );
  assert.deepEqual(expanded.slice(1, 4), ["read_file src/a.ts ✓  2 lines", "  │      1|one", "  │      2|two"]);
});

test("a tool label prefers string arguments and stays short", () => {
  assert.equal(toolLabel({ pattern: "**/*.py", path: "." }), "**/*.py .");
  assert.equal(toolLabel({ offset: 2 }), '{"offset":2}');
  assert.equal(toolLabel({}), "");
  assert.equal(toolLabel({ path: "" }), "");
  assert.equal(toolLabel({ path: "x".repeat(100) }).length, 80);
});

test("replies of one turn share a single golem label", () => {
  const asked: ChatMessage = {
    ...message("a", "assistant", ""),
    tools: [{ callId: "c1", name: "list_dir", args: { path: "" }, status: "done", summary: "3 entries" }],
  };
  const lines = layoutMessages([message("u", "user", "list"), asked, message("b", "assistant", "Three files.")], 40);
  assert.deepEqual(
    lines.map((line) => textOf(line.spans).trimEnd()),
    ["you", "list", "", "golem", "list_dir ✓  3 entries", "Three files."],
  );
});
