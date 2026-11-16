import { BUILD_TEXT, PLAN_HINT } from "@golem/view";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { PlanCardView } from "./plan-card.tsx";

const CWD = "/Users/you/repos/golem";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function setup() {
  history.replaceState(null, "", "/s/a");
  const fake = fakeClient();
  fake.raw.getConfig.mockResolvedValue({ rules: [], default_permission_mode: "balanced" } as never);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "Retry", last_seq: 2 });
  });
  await wait();
  act(() => {
    fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_name: "qwen3:8b", title: "Retry" }));
  });
  await wait();
  return fake;
}

type Fake = Awaited<ReturnType<typeof setup>>;

const PLAN = {
  title: "retry with backoff",
  steps: [
    { text: "Add with_retry to the fetcher", files: ["src/fetch.py"] },
    { text: "Add fetch_retries to settings", files: ["src/config.py"] },
    { text: "Test three failures then success", files: ["tests/test_fetch.py"] },
  ],
};

function propose(fake: Fake, callId = "c1", planId = "p1") {
  act(() => {
    fake.emitEvent(ev("a", "run.started", {}));
    fake.emitEvent(ev("a", "message.started", { message_id: `m-${callId}`, role: "assistant" }));
    fake.emitEvent(ev("a", "message.completed", { message_id: `m-${callId}`, role: "assistant", text: "Here is the plan." }));
    fake.emitEvent(ev("a", "tool.requested", { call_id: callId, message_id: `m-${callId}`, name: "propose_plan", args: PLAN }));
    fake.emitEvent(ev("a", "plan.proposed", { plan_id: planId, call_id: callId, ...PLAN }));
    fake.emitEvent(ev("a", "tool.completed", { call_id: callId, summary: "3 steps", preview: "" }));
    fake.emitEvent(ev("a", "run.completed", {}));
  });
}

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
});

const chip = () => screen.getByRole("button", { name: /Plan first/ });
const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

test("the Plan first chip shows the switch from the event and a click calls the store", async () => {
  const fake = await setup();
  expect(chip().getAttribute("aria-pressed")).toBe("false");
  expect(chip().getAttribute("title")).toBe(PLAN_HINT);
  const user = userEvent.setup();
  await user.click(chip());
  expect(fake.raw.setPlan).toHaveBeenCalledWith("a", true);
  act(() => fake.emitEvent(ev("a", "session.plan.changed", { on: true })));
  await waitFor(() => expect(chip().getAttribute("aria-pressed")).toBe("true"));
  await user.click(chip());
  expect(fake.raw.setPlan).toHaveBeenLastCalledWith("a", false);
});

test("the plan card shows the title, the numbered steps with their files, and the footer", async () => {
  const fake = await setup();
  propose(fake);
  const card = await screen.findByRole("group", { name: "Plan: retry with backoff" });
  expect(card.querySelectorAll("ol > li")).toHaveLength(3);
  expect(card.textContent).toContain("Add with_retry to the fetcher");
  expect(card.textContent).toContain("src/fetch.py");
  expect(card.textContent).toContain("3 steps · 3 files");
  expect(screen.queryByText("propose_plan")).toBeNull();
});

test("Build it turns plan first off, then sends the build message", async () => {
  const fake = await setup();
  propose(fake);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Build it" }));
  await waitFor(() => expect(fake.raw.sendMessage).toHaveBeenCalled());
  expect(fake.raw.setPlan).toHaveBeenCalledWith("a", false);
  expect(fake.raw.sendMessage.mock.calls[0]?.[1]).toBe(BUILD_TEXT);
  expect(fake.raw.setPlan.mock.invocationCallOrder[0]).toBeLessThan(fake.raw.sendMessage.mock.invocationCallOrder[0] ?? 0);
});

test("Change the plan focuses the composer and leaves the card open", async () => {
  const fake = await setup();
  propose(fake);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Change the plan…" }));
  expect(document.activeElement).toBe(box());
  expect(fake.raw.setPlan).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Build it" })).toBeTruthy();
});

test("a card is answered once a later run starts, and an older plan never has buttons", async () => {
  const fake = await setup();
  propose(fake);
  await screen.findByRole("button", { name: "Build it" });
  act(() => fake.emitEvent(ev("a", "run.started", {})));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Build it" })).toBeNull());
  expect(screen.queryByRole("button", { name: "Change the plan…" })).toBeNull();
  act(() => fake.emitEvent(ev("a", "run.completed", {})));
  propose(fake, "c2", "p2");
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Build it" })).toHaveLength(1));
  expect(screen.getAllByRole("group", { name: "Plan: retry with backoff" })).toHaveLength(2);
});

test("an answered card view has no buttons", () => {
  render(<PlanCardView title="t" steps={PLAN.steps} actions={null} />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

test("/plan toggles plan first and says so", async () => {
  const fake = await setup();
  const user = userEvent.setup();
  await user.click(box());
  await user.type(box(), "/plan{Enter}");
  await wait();
  expect(fake.raw.setPlan).toHaveBeenCalledWith("a", true);
  act(() => fake.emitEvent(ev("a", "session.plan.changed", { on: true })));
  await user.type(box(), "/plan off{Enter}");
  await wait();
  expect(fake.raw.setPlan).toHaveBeenLastCalledWith("a", false);
});
