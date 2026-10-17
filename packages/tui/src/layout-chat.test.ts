import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatMessage } from "./chat-state.ts";
import { gutterColumn, INTERRUPTED_MARK, layoutMessages, layoutTranscript, type Span } from "./layout-chat.ts";

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
