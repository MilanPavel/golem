import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { useInbox } from "../../store/inbox.ts";
import type { SessionSummary } from "../../store/session-list.ts";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { InboxPanel } from "../inbox/inbox-panel.tsx";
import { PendingDock } from "./pending-dock.tsx";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

type Pending = NonNullable<SessionSummary["pending"]>;

const SINCE = "2026-11-16T09:00:00Z";
const HELPER = { session_id: "h1", agent: "worker", label: "upgrade httpx", index: 0 };

function ask(extra: Partial<Pending> = {}): Pending {
  return { kind: "approval", since: SINCE, call_id: "c9", name: "shell", subject: "uv lock", source: "built-in default", helper: HELPER, count: 1, ...extra };
}

function lead(items: Pending[] | null, pending: Pending | null = items?.[0] ?? null): SessionSummary {
  return {
    ...summary("lead", SINCE, null, 2),
    title: "Upgrade the deps",
    status: "waiting",
    pending,
    ...(items === null ? {} : { pending_items: items }),
  };
}

function Both() {
  const inbox = useInbox();
  return <InboxPanel items={inbox.items} groups={inbox.groups} busy={inbox.busy} errors={inbox.errors} onAnswer={inbox.answer} onOpen={inbox.open} />;
}

function setup() {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      <div data-testid="dock">
        <PendingDock sessionId="lead" />
      </div>
      <div data-testid="inbox">
        <Both />
      </div>
    </PageProvider>,
  );
  const emit = (next: SessionSummary) => {
    act(() => {
      fake.emitSummary(next);
    });
  };
  return { fake, emit };
}

const dock = () => within(screen.getByTestId("dock"));
const inbox = () => within(screen.getByTestId("inbox"));

afterEach(() => {
  history.replaceState(null, "", "/");
});

test("a helper's approval is named on the first line, with the three scopes and their keys", () => {
  const { emit } = setup();
  emit(lead([ask({ count: 5 })]));
  expect(dock().getByText("worker · upgrade httpx asks")).toBeTruthy();
  expect(dock().getByText("5 helpers ask this · asks: built-in default")).toBeTruthy();
  const labels = dock().getAllByRole("button").map((b) => b.textContent);
  expect(labels).toEqual(["Allow once↵", "For this helperH", "For all 5 helpersT", "DenyD", "Open helper"]);
});

test("each button of the dock answers the helper's session with the decision and the scope", async () => {
  const { fake, emit } = setup();
  emit(lead([ask({ count: 2 })]));
  fireEvent.click(dock().getByRole("button", { name: /^Allow once/ }));
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c9", "allow");
  emit(lead([ask({ count: 2, call_id: "c10" })]));
  fireEvent.click(dock().getByRole("button", { name: /^For this helper/ }));
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c10", "allow_session");
  emit(lead([ask({ count: 2, call_id: "c11" })]));
  fireEvent.click(dock().getByRole("button", { name: /^For all 2 helpers/ }));
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c11", "allow", undefined, "batch");
  emit(lead([ask({ count: 2, call_id: "c12" })]));
  fireEvent.click(dock().getByRole("button", { name: /^Deny/ }));
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c12", "deny");
});

test("the keys Enter, h, t and d answer the same way; a draft in the composer keeps them", async () => {
  const { fake, emit } = setup();
  emit(lead([ask({ count: 3 })]));
  fireEvent.keyDown(document, { key: "h" });
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c9", "allow_session");
  emit(lead([ask({ count: 3, call_id: "c2" })]));
  fireEvent.keyDown(document, { key: "t" });
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c2", "allow", undefined, "batch");
  emit(lead([ask({ count: 3, call_id: "c3" })]));
  fireEvent.keyDown(document, { key: "Enter" });
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c3", "allow");
  emit(lead([ask({ count: 3, call_id: "c4" })]));
  fireEvent.keyDown(document, { key: "d" });
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c4", "deny");
});

test("one helper has no all-helpers answer, and t does nothing", async () => {
  const { fake, emit } = setup();
  emit(lead([ask()]));
  expect(dock().queryByRole("button", { name: /all .* helpers/ })).toBeNull();
  fireEvent.keyDown(document, { key: "t" });
  await wait();
  expect(fake.raw.respondApproval).not.toHaveBeenCalled();
});

test("two questions show one at a time with 1 of 2 and previous and next", () => {
  const { emit } = setup();
  const second = ask({ call_id: "c2", subject: "rm -rf build", since: "2026-11-16T09:05:00Z", helper: { ...HELPER, session_id: "h2", label: "clean", index: 1 } });
  emit(lead([ask(), second]));
  expect(dock().getByText("1 of 2")).toBeTruthy();
  expect(dock().getByText("worker · upgrade httpx asks")).toBeTruthy();
  expect((dock().getByRole("button", { name: "Previous question" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(dock().getByRole("button", { name: "Next question" }));
  expect(dock().getByText("2 of 2")).toBeTruthy();
  expect(dock().getByText("worker · clean asks")).toBeTruthy();
  expect(dock().queryByText("worker · upgrade httpx asks")).toBeNull();
  fireEvent.click(dock().getByRole("button", { name: "Previous question" }));
  expect(dock().getByText("1 of 2")).toBeTruthy();
});

test("the Inbox answers a helper's question for the helper's session, and its scopes", async () => {
  const { fake, emit } = setup();
  emit(lead([ask({ count: 2 })]));
  expect(inbox().getByText("2 waiting")).toBeTruthy();
  expect(inbox().getByText(/2 helpers ask this/)).toBeTruthy();
  fireEvent.click(inbox().getByRole("button", { name: /^For all 2 helpers, worker/ }));
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c9", "allow", undefined, "batch");
  emit(lead([ask({ count: 2, call_id: "c5" })]));
  fireEvent.click(inbox().getByRole("button", { name: /^For this helper, worker/ }));
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c5", "allow_session");
  emit(lead([ask({ count: 2, call_id: "c6" })]));
  fireEvent.click(inbox().getByRole("button", { name: /^Allow once, worker/ }));
  await wait();
  expect(fake.raw.respondApproval).toHaveBeenLastCalledWith("h1", "c6", "allow");
});

test("an answer in one place clears the other, and shows busy until then", async () => {
  const { emit } = setup();
  emit(lead([ask()]));
  fireEvent.click(dock().getByRole("button", { name: /^Allow once/ }));
  await wait();
  expect((inbox().getByRole("button", { name: /^Allow once, worker/ }) as HTMLButtonElement).disabled).toBe(false);
  expect((dock().getByRole("button", { name: /^Allow once/ }) as HTMLButtonElement).disabled).toBe(true);
  emit({ ...lead(null, null), pending_items: [], status: "running", last_seq: 4 });
  expect(screen.queryByText("worker · upgrade httpx asks")).toBeNull();
  expect(inbox().getByText("Nothing is waiting for you.")).toBeTruthy();
});

test("a helper's paid question shows what is sent and not sent, from the helper's session", async () => {
  const { fake, emit } = setup();
  emit(lead([{ kind: "consent", since: SINCE, alternatives: 3, helper: HELPER, sent: ["the brief"], not_sent: ["this chat"] }]));
  expect(dock().getByText("Sent: the brief")).toBeTruthy();
  act(() => {
    fake.emitEvent(
      ev("h1", "route.consent.needed", {
        model_profile: "deepseek/deepseek-chat",
        model: "deepseek-chat",
        tier: "budget",
        why: "The brief needs a bigger model.",
        alternatives: ["once", "local"],
        agent: "worker",
        label: "upgrade httpx",
        helper_id: "h1",
        sent: ["the brief"],
        not_sent: ["this chat"],
      }),
    );
  });
  await wait();
  expect(dock().getByText("worker · upgrade httpx asks")).toBeTruthy();
  expect(dock().getByText("Sent: the brief")).toBeTruthy();
  expect(dock().getByText("Not sent: this chat")).toBeTruthy();
  fireEvent.click(dock().getByRole("button", { name: "Just this once" }));
  await wait();
  expect(fake.raw.answerConsent).toHaveBeenCalledWith("h1", expect.any(String), "once");
});

test("the lead's own approval keeps its own card, without a counter or helper scopes", () => {
  const { emit } = setup();
  emit(lead([ask({ helper: null, call_id: "own" })]));
  expect(screen.queryByRole("group", { name: "Questions waiting" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Helper question" })).toBeNull();
  expect(inbox().getAllByRole("button").map((b) => b.textContent)).toEqual(["Allow once", "Allow for this session", "Deny", "Open"]);
});

test("an older daemon, with only pending, keeps the old dock and the old Inbox", () => {
  const { emit } = setup();
  emit(lead(null, ask({ helper: null, count: null })));
  expect(screen.queryByRole("group", { name: "Questions waiting" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Helper question" })).toBeNull();
  expect(inbox().getAllByRole("button").map((b) => b.textContent)).toEqual(["Allow once", "Allow for this session", "Deny", "Open"]);
});
