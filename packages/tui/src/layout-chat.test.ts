import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatMessage } from "./chat-state.ts";
import { layoutChat, type Span } from "./layout-chat.ts";

function textOf(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join("");
}

test("layout keeps the tail above the status and input rows", () => {
  const messages: ChatMessage[] = [];
  for (let index = 0; index < 8; index += 1) {
    messages.push({
      id: String(index),
      role: "user",
      text: `line ${index}`,
      streaming: false,
    });
  }
  const lines = layoutChat(messages, 40, 6);
  assert.equal(lines.length, 4);
  const rendered = lines.map(textOf).join("\n");
  assert.match(rendered, /line 7/);
  assert.doesNotMatch(rendered, /line 0/);
});

test("completed messages render markdown and streaming stays plain", () => {
  const completed = layoutChat(
    [
      {
        id: "a",
        role: "assistant",
        text: "Hello **world**\n\n- one\n\n```\ncode\n```",
        streaming: false,
      },
    ],
    80,
    24,
  );
  const spans = completed.flat();
  assert.ok(spans.some((span) => span.text === "world" && span.bold === true));
  assert.ok(spans.some((span) => span.text === "code" && span.code === true));
  assert.ok(completed.some((line) => line[0]?.text === "- "));

  const streaming = layoutChat(
    [{ id: "a", role: "assistant", text: "**bold**", streaming: true }],
    80,
    10,
  );
  assert.equal(streaming[1]?.[0]?.text, "**bold**");
  assert.equal(streaming[1]?.[0]?.bold, undefined);
});
