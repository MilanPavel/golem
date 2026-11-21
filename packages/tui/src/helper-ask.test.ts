import assert from "node:assert/strict";
import { test } from "node:test";

import type { InboxPending, InboxSession } from "@golem/view";

import { helperAskAnswer, helperAskLines, helperAskRows, helperDock, isHelperApproval, isHelperConsent, nextAskKey, pagerText, askKey } from "./helper-ask.ts";
import { pressKey, type KeyPlace } from "./keys.ts";

const NOW = Date.parse("2026-11-16T10:00:00Z");

function helperItem(index: number, extra: Partial<InboxPending> = {}): InboxPending {
  return {
    kind: "approval",
    since: `2026-11-16T09:5${String(index)}:00Z`,
    call_id: `c${String(index)}`,
    name: "shell",
    subject: "uv lock",
    source: "built-in default",
    helper: { session_id: `h${String(index)}`, agent: "worker", label: "upgrade httpx", index },
    count: 1,
    ...extra,
  };
}

function lead(items: InboxPending[] | null, pending: InboxPending | null = items?.[0] ?? null): InboxSession {
  return { session_id: "lead", title: "Lead", status: "waiting", pending, ...(items === null ? {} : { pending_items: items }) };
}

function shown(items: InboxPending[], picked: string | null = null) {
  const dock = helperDock(lead(items), picked, NOW);
  assert.ok(dock);
  return dock;
}

test("a helper's approval names the helper first, then what it asks, the rule and the keys", () => {
  const dock = shown([helperItem(1)]);
  assert.deepEqual(
    helperAskLines(dock, 100).map((line) => line.text),
    [
      "worker · upgrade httpx asks",
      "Run uv lock",
      "asked by built-in default",
      "a once · h this helper · d deny",
    ],
  );
  assert.equal(helperAskRows(dock), 4);
  assert.equal(isHelperApproval(dock), true);
  assert.equal(isHelperConsent(dock), false);
});

test("a grouped item says how many helpers ask, and offers all of them", () => {
  const dock = shown([helperItem(1, { count: 5 })]);
  const lines = helperAskLines(dock, 100).map((line) => line.text);
  assert.equal(lines[1], "Run uv lock · 5 helpers ask this");
  assert.equal(lines[3], "a once · h this helper · t all 5 helpers · d deny");
});

test("two items show one at a time with 1 of 2, and Tab goes round", () => {
  const items = [helperItem(1), helperItem(2, { subject: "rm -rf build" })];
  const first = shown(items);
  assert.equal(helperAskLines(first, 100)[0]?.text, "worker · upgrade httpx asks · 1 of 2 · tab next");
  assert.equal(pagerText(first), "1 of 2 · tab next");
  const second = shown(items, nextAskKey(first));
  assert.equal(second.index, 1);
  assert.equal(helperAskLines(second, 100)[1]?.text, "Run rm -rf build");
  assert.equal(shown(items, nextAskKey(second)).index, 0);
  // A picked item that is gone falls back to the oldest.
  assert.equal(shown(items, "h9:c9").index, 0);
});

test("each answer goes to the helper's session with its decision and scope", () => {
  const item = shown([helperItem(1, { count: 3 })]).item;
  assert.deepEqual(helperAskAnswer(item, "once"), { sessionId: "h1", callId: "c1", decision: "allow" });
  assert.deepEqual(helperAskAnswer(item, "helper"), { sessionId: "h1", callId: "c1", decision: "allow_session" });
  assert.deepEqual(helperAskAnswer(item, "all-helpers"), { sessionId: "h1", callId: "c1", decision: "allow", scope: "batch" });
  assert.deepEqual(helperAskAnswer(item, "deny"), { sessionId: "h1", callId: "c1", decision: "deny" });
});

test("one helper has no all-helpers answer", () => {
  const item = shown([helperItem(1)]).item;
  assert.equal(helperAskAnswer(item, "all-helpers"), null);
});

test("a helper's paid question shows what is sent and not sent", () => {
  const ask: InboxPending = { kind: "consent", since: "2026-11-16T09:55:00Z", sent: ["the brief"], not_sent: ["this chat"], helper: { session_id: "h3", agent: "researcher", index: 2 } };
  const dock = shown([ask]);
  assert.equal(isHelperConsent(dock), true);
  const lines = helperAskLines(dock, 100).map((line) => line.text);
  assert.deepEqual(lines.slice(0, 4), ["researcher asks", "Use a paid model for this message?", "Sent: the brief", "Not sent: this chat"]);
  assert.equal(helperAskRows(dock), lines.length);
  assert.equal(helperAskAnswer(dock.item, "once"), null);
});

test("the lead's own item, and an older daemon, keep today's band", () => {
  const own = helperItem(1, { helper: null });
  assert.equal(helperDock(lead([own]), null, NOW), null);
  assert.equal(helperDock(lead(null, own), null, NOW), null);
  assert.equal(helperDock(undefined, null, NOW), null);
  // Own and a helper's in one list: the own one is shown first when older, and is not a helper's approval.
  const mixed = helperDock(lead([{ ...own, since: "2026-11-16T09:00:00Z" }, helperItem(2)]), null, NOW);
  assert.ok(mixed);
  assert.equal(mixed.item.helper, null);
  assert.equal(isHelperApproval(mixed), false);
  assert.equal(helperAskLines(mixed, 80).length > 0, true);
  assert.equal(askKey(mixed.item), "lead:c1");
});

function place(where: Partial<KeyPlace> = {}): KeyPlace {
  return {
    overlay: false,
    help: false,
    switcher: false,
    switcherConfirm: false,
    switcherFiltering: false,
    debug: false,
    draftEmpty: true,
    busy: true,
    connected: true,
    suggestions: false,
    history: false,
    ...where,
  };
}

test("while a helper asks, a, Enter, h, t, d and Esc answer, and Tab moves on", () => {
  const asking = place({ helperAsk: true, askPages: true });
  const press = (input: string, name: Parameters<typeof pressKey>[1]["name"] = null) => pressKey(asking, { name, input, ctrl: false, meta: false });
  assert.deepEqual(press("a"), { kind: "helper-ask", answer: "once" });
  assert.deepEqual(press("", "return"), { kind: "helper-ask", answer: "once" });
  assert.deepEqual(press("h"), { kind: "helper-ask", answer: "helper" });
  assert.deepEqual(press("t"), { kind: "helper-ask", answer: "all-helpers" });
  assert.deepEqual(press("d"), { kind: "helper-ask", answer: "deny" });
  assert.deepEqual(press("", "escape"), { kind: "helper-ask", answer: "deny" });
  assert.deepEqual(press("", "tab"), { kind: "ask-next" });
  assert.deepEqual(press("s"), { kind: "ignore" });
  assert.deepEqual(press("", "ctrl-c"), { kind: "cancel" });
});

test("without a helper's question the helper keys do nothing, and the lead's own keys are unchanged", () => {
  const own = place({ approval: true });
  const press = (where: KeyPlace, input: string, name: Parameters<typeof pressKey>[1]["name"] = null) => pressKey(where, { name, input, ctrl: false, meta: false });
  assert.deepEqual(press(own, "a"), { kind: "approve", decision: "allow" });
  assert.deepEqual(press(own, "h"), { kind: "ignore" });
  assert.deepEqual(press(own, "t"), { kind: "ignore" });
  assert.notEqual(press(own, "", "tab").kind, "ask-next");
  // Several questions wait and the own one is shown: Tab pages, a still answers it.
  const paged = place({ approval: true, askPages: true });
  assert.deepEqual(press(paged, "", "tab"), { kind: "ask-next" });
  assert.deepEqual(press(paged, "a"), { kind: "approve", decision: "allow" });
});
