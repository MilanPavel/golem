import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inboxHelperAskWords, inboxHelperCountWords, inboxCount, inboxGroups, inboxItems, pendingItemsOf, type InboxPending, type InboxSession } from "./inbox.ts";

const NOW = Date.parse("2026-11-16T12:00:00Z");

function session(id: string, pending: InboxPending | null | undefined, extra: Partial<InboxSession> = {}): InboxSession {
  return { session_id: id, title: `Chat ${id}`, status: "waiting", pending, ...extra };
}

function approval(name: string, subject: string | null, extra: Partial<InboxPending> = {}): InboxPending {
  return { kind: "approval", since: "2026-11-16T11:55:00Z", call_id: "c1", name, subject, source: "ask", ...extra };
}

const headlineOf = (pending: InboxPending) => inboxItems([session("a", pending)], NOW)[0]!.headline;

describe("inboxItems", () => {
  it("lists oldest first, ties by session id", () => {
    const items = inboxItems(
      [
        session("c", approval("shell", "ls", { since: "2026-11-16T11:00:00Z" })),
        session("b", approval("shell", "ls", { since: "2026-11-16T10:00:00Z" })),
        session("a", approval("shell", "ls", { since: "2026-11-16T11:00:00Z" })),
      ],
      NOW,
    );
    assert.deepEqual(items.map((item) => item.sessionId), ["b", "a", "c"]);
  });

  it("lists a batch item with the card's head, and skips a kind it does not know", () => {
    const batch: InboxPending = { kind: "batch", since: "2026-11-16T11:50:00Z", call_id: "c9", helper_count: 3, agents: ["explorer", "explorer", "worker"] };
    const unknown = { kind: "future", since: "2026-11-16T11:51:00Z" } as unknown as InboxPending;
    const items = inboxItems([session("a", null, { pending_items: [batch, unknown, approval("shell", "ls")] }), session("b", null, { pending_items: [batch] })], NOW);
    assert.deepEqual(items.map((item) => [item.sessionId, item.kind]), [["a", "batch"], ["b", "batch"], ["a", "approval"]]);
    const first = items[0]!;
    assert.equal(first.headline, "3 helpers · explorer ×2, worker");
    assert.equal(first.callId, "c9");
    assert.equal(first.answerSessionId, "a");
    assert.equal(first.helper, null);
    assert.equal(first.source, null);
    assert.deepEqual(first.agents, ["explorer", "explorer", "worker"]);
    assert.equal(headlineOf({ kind: "batch", since: "2026-11-16T11:50:00Z", call_id: "c1", helper_count: 1, agents: ["explorer"] }), "1 helper · explorer");
  });

  it("skips sessions with nothing pending and closed sessions", () => {
    const items = inboxItems(
      [session("a", null), session("b", undefined), session("c", approval("shell", "ls"), { status: "closed" }), session("d", approval("shell", "ls"))],
      NOW,
    );
    assert.deepEqual(items.map((item) => item.sessionId), ["d"]);
  });

  it("fills the fields of an approval", () => {
    const [item] = inboxItems([session("a", approval("edit_file", "src/x.tsx", { added: 1, removed: 2 }))], NOW);
    assert.partialDeepStrictEqual(item, { kind: "approval", callId: "c1", source: "ask", since: "2026-11-16T11:55:00Z", age: "5m", added: 1, removed: 2 });
  });

  it("says Untitled for a session without a title", () => {
    assert.equal(inboxItems([session("a", approval("shell", "ls"), { title: null })], NOW)[0]!.sessionTitle, "Untitled");
  });

  it("says Untitled for an empty title", () => {
    assert.equal(inboxItems([session("a", approval("shell", "ls"), { title: "  " })], NOW)[0]!.sessionTitle, "Untitled");
  });

  it("words each headline", () => {
    assert.equal(headlineOf(approval("shell", "git push origin main")), "Run `git push origin main`");
    assert.equal(headlineOf(approval("edit_file", "web/src/sidebar.tsx", { added: 12, removed: 4 })), "Edit `sidebar.tsx` +12 −4");
    assert.equal(headlineOf(approval("edit_file", "web/src/sidebar.tsx", { added: 12 })), "Edit `sidebar.tsx`");
    assert.equal(headlineOf(approval("edit_file", "sidebar.tsx")), "Edit `sidebar.tsx`");
    assert.equal(headlineOf(approval("write_file", "a/sidebar.tsx", { added: 12 })), "Write `sidebar.tsx` +12");
    assert.equal(headlineOf(approval("write_file", "a/sidebar.tsx")), "Write `sidebar.tsx`");
    assert.equal(headlineOf(approval("web_fetch", "example.com")), "Use `web_fetch` on `example.com`");
    assert.equal(headlineOf(approval("web_fetch", null)), "Use `web_fetch`");
    assert.equal(headlineOf({ kind: "consent", since: "2026-11-16T11:55:00Z", alternatives: 2 }), "Use a paid model for this message?");
  });

  it("gives a consent no call and no source", () => {
    const [item] = inboxItems([session("a", { kind: "consent", since: "2026-11-16T11:55:00Z", alternatives: 2 })], NOW);
    assert.partialDeepStrictEqual(item, { kind: "consent", callId: null, source: null, added: null, removed: null });
  });

  it("squeezes a long subject to one line and cuts it at 80 characters", () => {
    const long = `echo ${"x".repeat(100)}`;
    assert.equal(headlineOf(approval("shell", long)), `Run \`${long.slice(0, 80)}…\``);
    assert.equal(headlineOf(approval("shell", "echo  a\n  b")), "Run `echo a b`");
  });

  it("says the age in minutes, hours and days", () => {
    const age = (since: string) => inboxItems([session("a", approval("shell", "ls", { since }))], NOW)[0]!.age;
    assert.equal(age("2026-11-16T11:59:30Z"), "now");
    assert.equal(age("2026-11-16T11:56:00Z"), "4m");
    assert.equal(age("2026-11-16T10:00:00Z"), "2h");
    assert.equal(age("2026-11-13T12:00:00Z"), "3d");
  });
});

describe("pendingItemsOf", () => {
  const one = approval("shell", "ls");
  const two = approval("shell", "uv lock", { count: 5, helper: { session_id: "h1", agent: "worker", index: 0 } });

  it("reads pending_items when the daemon sends them", () => {
    assert.deepEqual(pendingItemsOf({ pending: one, pending_items: [one, two] }), [one, two]);
  });

  it("falls back to [pending] for an older daemon", () => {
    assert.deepEqual(pendingItemsOf({ pending: one }), [one]);
    assert.deepEqual(pendingItemsOf({ pending: one, pending_items: [] }), [one]);
  });

  it("is empty when nothing waits", () => {
    assert.deepEqual(pendingItemsOf({ pending: null }), []);
    assert.deepEqual(pendingItemsOf({}), []);
  });
});

function helperItem(n: number, extra: Partial<InboxPending> = {}): InboxPending {
  return approval("shell", "uv lock", {
    call_id: `h${n}`,
    helper: { session_id: `h${n}`, agent: "worker", label: "upgrade httpx", index: n },
    ...extra,
  });
}

describe("helpers in the Inbox", () => {
  it("five helpers asking the same thing are one group, one item, count 5", () => {
    const lead = session("lead", helperItem(1, { count: 5 }), { pending_items: [helperItem(1, { count: 5 })] });
    const helpers = [1, 2, 3, 4, 5].map((n) =>
      session(`h${n}`, approval("shell", "uv lock", { call_id: `h${n}` }), { parent_session_id: "lead" }),
    );
    const groups = inboxGroups([lead, ...helpers], NOW);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.items.length, 1);
    assert.equal(groups[0]!.items[0]!.count, 5);
    assert.equal(groups[0]!.waiting, 5);
    assert.equal(groups[0]!.items[0]!.helper?.name, "worker \u00b7 upgrade httpx");
    assert.equal(inboxHelperAskWords(5), "5 helpers ask this");
    assert.equal(inboxHelperCountWords(2), "2 helpers");
    assert.equal(inboxHelperCountWords(1), null);
  });

  it("two different questions are two items under one lead, oldest first", () => {
    const a = helperItem(1, { since: "2026-11-16T11:50:00Z" });
    const b = helperItem(2, { since: "2026-11-16T11:40:00Z", subject: "rm x" });
    const groups = inboxGroups([session("lead", a, { pending_items: [a, b] })], NOW);
    assert.deepEqual(groups[0]!.items.map((item) => item.callId), ["h2", "h1"]);
    assert.equal(inboxCount(groups[0]!.items), 2);
  });

  it("a lead's own item and a helper's are in one group", () => {
    const own = approval("edit_file", "a.ts", { call_id: "own", since: "2026-11-16T11:00:00Z" });
    const h = helperItem(1);
    const groups = inboxGroups([session("lead", own, { pending_items: [own, h] })], NOW);
    const [first, second] = groups[0]!.items;
    assert.equal(first!.helper, null);
    assert.equal(first!.answerSessionId, "lead");
    assert.equal(second!.answerSessionId, "h1");
    assert.equal(second!.sessionId, "lead");
  });

  it("a helper's paid question carries what is sent and not sent", () => {
    const ask: InboxPending = { kind: "consent", since: "2026-11-16T11:55:00Z", sent: ["the brief"], not_sent: ["this chat"], helper: { session_id: "h1", agent: "worker", index: 0 } };
    const [item] = inboxItems([session("lead", ask, { pending_items: [ask] })], NOW);
    assert.deepEqual(item!.sent, ["the brief"]);
    assert.deepEqual(item!.notSent, ["this chat"]);
    assert.deepEqual(inboxItems([session("a", approval("shell", "ls"))], NOW)[0]!.sent, []);
  });

  it("an older daemon: no pending_items falls back to pending", () => {
    const items = inboxItems([session("a", approval("shell", "ls"))], NOW);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.count, 1);
    assert.equal(items[0]!.helper, null);
  });

  it("a helper whose lead is not listed still shows, as its own group", () => {
    const groups = inboxGroups([session("h1", approval("shell", "ls"), { parent_session_id: "gone" })], NOW);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.sessionId, "h1");
  });
});
