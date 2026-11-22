import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";

const CWD = "/Users/you/repos/golem";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function open() {
  history.replaceState(null, "", "/s/a");
  const fake = fakeClient();
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
  act(() => fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "UTF-8 split" }));
  await wait();
  act(() => fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_provider: "ollama", model_name: "qwen3:27b" })));
  act(() => {
    fake.emitEvent(ev("a", "model.call.started", { message_id: "m_1", index: 1, profile: "default", context_window: 128000 }));
    fake.emitEvent(ev("a", "model.call.completed", { message_id: "m_1", latency_ms: 900, usage: { input: 38000, output: 10 } }));
  });
  await wait();
  return fake;
}

const row = () => document.querySelector("[data-composer-bar]") as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
});

test("the row inside the composer has the model, the folder, the context, the mode and Send, and does not wrap", async () => {
  await open();
  const bar = within(row());
  expect(bar.getByRole("button", { name: /^Model: qwen3:27b/ })).toBeTruthy();
  expect(bar.getByTitle(CWD).textContent).toBe("golem");
  expect(bar.getByRole("button", { name: /^Context / })).toBeTruthy();
  expect(bar.getByRole("button", { name: /^Permission mode: / })).toBeTruthy();
  expect(bar.getByRole("button", { name: "Send" })).toBeTruthy();
  expect(row().closest("[data-composer]")).not.toBeNull();
  // The row never wraps, and its box is a container the steps are measured against.
  expect(row().className).toContain("flex-nowrap");
  expect(row().parentElement?.parentElement?.className).toContain("@container/comp");
  // Model, folder, then (at the right) context, mode and Send.
  const order = Array.from(row().querySelectorAll("button, [title]")).map((node) => node.getAttribute("aria-label") ?? node.getAttribute("title") ?? "");
  expect(order[0]).toMatch(/^Model:/);
  expect(order.at(-1)).toBe("Send");
});

test("the chips that went to the row are gone from above the composer and from the top bar", async () => {
  await open();
  const top = within(screen.getByRole("banner"));
  expect(top.queryByRole("button", { name: /^Model:/ })).toBeNull();
  expect(top.queryByTitle(CWD)).toBeNull();
  expect(top.getByRole("button", { name: "Inspect" })).toBeTruthy();
  expect(top.getByRole("button", { name: /^(Show|Hide) details$/ })).toBeTruthy();
  for (const name of [/^Route: /, /^Changed options: /, /^Plan first$/]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
  // The meter is only the golem and its words.
  expect(document.querySelector("[data-meter]")?.querySelector("button")).toBeNull();
});

test("the route is set from the model menu, as its first section", async () => {
  const fake = await open();
  const user = userEvent.setup();
  await user.click(within(row()).getByRole("button", { name: /^Model:/ }));
  const menu = await screen.findByRole("dialog", { name: "Model and route" });
  expect(menu.firstElementChild?.querySelector("[role='radiogroup']")).toBeTruthy();
  await user.click(within(menu).getByRole("radio", { name: "Local only" }));
  expect(fake.raw.setRoute).toHaveBeenCalledWith("a", "local");
});

test("Plan first is a switch at the bottom of the mode menu, and with it on the chip reads Plan", async () => {
  const fake = await open();
  const user = userEvent.setup();
  await user.click(within(row()).getByRole("button", { name: /^Permission mode: / }));
  const menu = await screen.findByRole("menu");
  const items = within(menu).getAllByRole("menuitemcheckbox");
  expect(items.map((item) => item.textContent)).toEqual(["Plan firstgolem only reads, then shows a plan. Nothing changes until you say Build it."]);
  expect(menu.lastElementChild).toBe(items[0]);
  await user.click(items[0] as HTMLElement);
  expect(fake.raw.setPlan).toHaveBeenCalledWith("a", true);
  act(() => fake.emitEvent(ev("a", "session.plan.changed", { on: true })));
  const chip = within(row()).getByRole("button", { name: /^Permission mode: .*Plan first is on/ });
  expect(chip.textContent).toBe("Plan");
  expect(chip.className).toContain("bg-clay-soft");
});

test("the Tune dot and the notes strip show only when there is something to show", async () => {
  await open();
  expect(row().querySelector("[data-tuned]")).toBeNull();
  expect(screen.queryByRole("button", { name: /notes?\. Open the Changes tab\./ })).toBeNull();
});
