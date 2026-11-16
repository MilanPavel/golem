import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inboxItems, type InboxPending, type InboxSession } from "./inbox.ts";

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
