import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { emptyChat, reduceChat } from "./chat-state.ts";
import { citeCounts, citedTimes, displayUrl, hostHue, hostLetter, hostOf, normalizeUrl, sourceFor, turnSources, type ToolSource } from "./sources.ts";

const hit = (url: string, title = "t"): ToolSource => ({ url, title, snippet: "s", kind: "search" });
const read = (url: string, title = "r"): ToolSource => ({ url, title, snippet: "page", kind: "read" });

test("a URL is normalized without fragment, trailing slash, or host case", () => {
  assert.equal(normalizeUrl("HTTPS://ArXiv.org/abs/1#top"), "https://arxiv.org/abs/1");
  assert.equal(normalizeUrl("https://arxiv.org/abs/1/"), "https://arxiv.org/abs/1");
  assert.equal(normalizeUrl("https://a.com/"), "https://a.com");
  assert.equal(normalizeUrl("https://a.com/p?q=1"), "https://a.com/p?q=1");
});

test("only http and https URLs are sources", () => {
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("mailto:a@b.c"), null);
  assert.equal(normalizeUrl("not a url"), null);
});

test("turnSources dedupes, keeps first-seen order, and read wins over search", () => {
  const sources = turnSources([
    { sources: [hit("https://a.com/x/"), hit("https://b.com/y")] },
    { sources: [read("https://A.com/x#frag", "A read")], sourcesAt: "2026-01-01T14:02:00Z" },
    { sources: [hit("https://a.com/x", "again")] },
    {},
  ]);
  assert.deepEqual(
    sources.map((s) => s.url),
    ["https://A.com/x#frag", "https://b.com/y"],
  );
  assert.equal(sources[0]?.kind, "read");
  assert.equal(sources[0]?.title, "A read");
  assert.equal(sources[0]?.at, "2026-01-01T14:02:00Z");
});

test("sourceFor matches an href to a source by normalized URL", () => {
  const sources = turnSources([{ sources: [read("https://a.com/x")] }]);
  assert.equal(sourceFor(sources, "https://A.com/x/#y")?.kind, "read");
  assert.equal(sourceFor(sources, "https://a.com/other"), undefined);
  assert.equal(sourceFor(sources, "javascript:alert(1)"), undefined);
});

test("cite counts count each source's links in the answer text", () => {
  const sources = turnSources([{ sources: [read("https://a.com/x"), hit("https://b.com/y"), hit("https://c.com/")] }]);
  const counts = citeCounts(sources, 'One [A](https://a.com/x) and [A again](https://a.com/x/) and [B](https://b.com/y "t"). [Z](https://z.com)');
  assert.equal(citedTimes(counts, sources[0] as ToolSource), 2);
  assert.equal(citedTimes(counts, sources[1] as ToolSource), 1);
  assert.equal(citedTimes(counts, sources[2] as ToolSource), 0);
});

test("host helpers", () => {
  assert.equal(hostOf("https://www.Example.com/a"), "example.com");
  assert.equal(displayUrl("https://arxiv.org/abs/1/"), "arxiv.org/abs/1");
  assert.equal(hostLetter("www.arxiv.org"), "A");
  assert.equal(hostHue("arxiv.org"), hostHue("arxiv.org"));
  assert.ok(hostHue("arxiv.org") >= 0 && hostHue("arxiv.org") < 360);
  assert.notEqual(hostHue("arxiv.org"), hostHue("example.com"));
});

test("tool.completed puts its sources on the tool block", () => {
  const base = { session_id: "s", run_id: "r" } as const;
  const events: ChatEvent[] = [
    { ...base, ts: "t", seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, ts: "t", seq: 2, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    { ...base, ts: "t", seq: 3, type: "tool.requested", data: { call_id: "c1", message_id: "a", name: "web_fetch", args: {} } },
    {
      ...base,
      ts: "2026-01-01T00:00:02Z",
      seq: 4,
      type: "tool.completed",
      data: { call_id: "c1", summary: "ok", preview: "", truncated: false, sources: [read("https://a.com/x")] },
    },
  ];
  const tool = events.reduce(reduceChat, emptyChat).messages[0]?.tools?.[0];
  assert.deepEqual(tool?.sources, [read("https://a.com/x")]);
  assert.equal(tool?.sourcesAt, "2026-01-01T00:00:02Z");
});
