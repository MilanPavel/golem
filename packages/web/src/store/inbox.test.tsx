import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { answerInboxItem, approvalCardId, CONSENT_CARD_ID, inboxKey, openInboxItem, useInbox } from "./inbox.ts";
import { createPage } from "./page.ts";
import { PageProvider } from "./page-context.tsx";
import { fakeClient, fakeFrame, summary } from "./test-support.ts";
import type { SessionSummary } from "./session-list.ts";

const tick = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function waiting(id: string, callId = "c1"): SessionSummary {
  return {
    ...summary(id, "2026-11-16T09:00:00Z", null, 2),
    title: `Session ${id}`,
    status: "waiting",
    pending: { kind: "approval", since: "2026-11-16T09:00:00Z", call_id: callId, name: "shell", subject: "ls", source: "built-in default" },
  };
}

function setup() {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  const wrapper = ({ children }: { children: ReactNode }) => <PageProvider page={page}>{children}</PageProvider>;
  const hook = renderHook(() => useInbox(), { wrapper });
  const emit = (next: SessionSummary) => {
    act(() => {
      fake.emitSummary(next);
    });
  };
  return { fake, page, hook, emit };
}

test("answerInboxItem calls respond with the session, the call and the decision", async () => {
  const respond = vi.fn(() => Promise.resolve());
  await answerInboxItem({ respond }, "s1", "c1", "allow_session");
  expect(respond).toHaveBeenCalledWith("s1", "c1", "allow_session");
});

test("an answered item stays until the list changes, then leaves with the summary that clears it", async () => {
  const { fake, hook, emit } = setup();
  emit(waiting("s1"));
  const item = hook.result.current.items[0]!;
  act(() => {
    hook.result.current.answer(item, "allow");
  });
  await tick();
  expect(fake.raw.respondApproval).toHaveBeenCalledWith("s1", "c1", "allow");
  expect(hook.result.current.items).toHaveLength(1);
  expect(hook.result.current.busy[inboxKey(item)]).toBe(true);
  emit({ ...waiting("s1"), status: "idle", pending: null, last_seq: 3 });
  expect(hook.result.current.items).toHaveLength(0);
  expect(hook.result.current.busy).toEqual({});
});

test("an answer from another connection removes the item the same way", () => {
  const { hook, emit } = setup();
  emit(waiting("s1"));
  emit(waiting("s2", "c2"));
  expect(hook.result.current.items.map((i) => i.sessionId)).toEqual(["s1", "s2"]);
  emit({ ...waiting("s1"), status: "running", pending: null, last_seq: 3 });
  expect(hook.result.current.items.map((i) => i.sessionId)).toEqual(["s2"]);
});

test("a failed answer keeps the item, shows the error and frees the buttons", async () => {
  const { fake, hook, emit } = setup();
  emit(waiting("s1"));
  fake.raw.respondApproval.mockRejectedValueOnce(new Error("no link"));
  const item = hook.result.current.items[0]!;
  act(() => {
    hook.result.current.answer(item, "deny");
  });
  await tick();
  expect(hook.result.current.items).toHaveLength(1);
  expect(hook.result.current.busy).toEqual({});
  expect(hook.result.current.errors[inboxKey(item)]).toBe("no link");
  act(() => {
    hook.result.current.answer(item, "deny");
  });
  expect(hook.result.current.errors).toEqual({});
});

test("a consent has no answer here", () => {
  const { fake, hook, emit } = setup();
  emit({ ...waiting("s1"), pending: { kind: "consent", since: "2026-11-16T09:00:00Z", alternatives: 3 } });
  act(() => {
    hook.result.current.answer(hook.result.current.items[0]!, "allow");
  });
  expect(fake.raw.respondApproval).not.toHaveBeenCalled();
});

test("Open goes to the session and scrolls to the card once it exists", () => {
  const navigate = vi.fn();
  const scroll = vi.fn();
  const mount = document.createElement("div");
  document.body.append(mount);
  openInboxItem({ sessionId: "s1", callId: "c1" }, navigate);
  expect(navigate).toHaveBeenCalledWith("/s/s1");
  const card = document.createElement("section");
  card.id = approvalCardId("c1");
  card.scrollIntoView = scroll;
  return new Promise<void>((resolve) => {
    mount.append(card);
    setTimeout(() => {
      expect(scroll).toHaveBeenCalledTimes(1);
      mount.remove();
      resolve();
    }, 5);
  });
});

test("Open on a consent scrolls to the consent card", () => {
  const navigate = vi.fn();
  const scroll = vi.fn();
  const card = document.createElement("section");
  card.id = CONSENT_CARD_ID;
  card.scrollIntoView = scroll;
  document.body.append(card);
  openInboxItem({ sessionId: "s3", callId: null }, navigate);
  expect(navigate).toHaveBeenCalledWith("/s/s3");
  expect(scroll).toHaveBeenCalledTimes(1);
  card.remove();
});
