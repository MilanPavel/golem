import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { closeModelDialog } from "../models/index.ts";
import { sampleOptionsResult } from "../models/sample-tune.ts";
import { SAMPLE_LISTING } from "../models/sample.ts";

const CWD = "/Users/you/repos/golem";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function setup(provider: string, saved: Record<string, number | string> = { temperature: 0.2, top_p: 0.5, num_ctx: 8192 }) {
  history.replaceState(null, "", "/s/a");
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(SAMPLE_LISTING);
  fake.raw.getModelOptions.mockImplementation(async (model) => ({ ...sampleOptionsResult(model), saved }));
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.setupStart.decide();
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  act(() => {
    fake.emitEvent(
      ev("a", "session.created", { cwd: CWD, model_profile: "local", model_provider: provider, model_name: "qwen3:8b", title: "UTF-8 split" }),
    );
  });
  return fake;
}

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
});
afterEach(() => {
  closeModelDialog();
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const chip = () => screen.getByRole("button", { name: /^Model: / });
const dot = () => chip().querySelector("[data-tuned]");
/** The menu's Tune… row, with the changed values under it. */
async function tuneRow(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement | null> {
  await user.click(chip());
  const menu = await screen.findByRole("dialog", { name: "Model and route" });
  return within(menu).queryByRole("button", { name: /^Tune…/ });
}

test("the model chip shows a dot when options changed, and the menu's Tune… names the values (without num_ctx) and opens the Tune view", async () => {
  const fake = await setup("ollama");
  await waitFor(() => expect(dot()).not.toBeNull());
  expect(chip().getAttribute("aria-label")).toContain("options changed");
  expect(fake.raw.getModelOptions).toHaveBeenCalledWith("qwen3:8b", "a");
  const user = userEvent.setup();
  const row = await tuneRow(user);
  expect(row?.textContent).toBe("Tune…temp 0.2 · top_p 0.5");
  await user.click(row as HTMLElement);
  expect(await screen.findByRole("heading", { name: "Tune Qwen3 8B" })).toBeTruthy();
});

test("a session override and a save from another client change the values, and clearing them takes the dot away", async () => {
  const fake = await setup("ollama");
  await waitFor(() => expect(dot()).not.toBeNull());
  act(() => fake.emitEvent(ev("a", "model.options.changed", { options: { top_k: 12, min_p: 0.1, repeat_penalty: 1.3 } })));
  const user = userEvent.setup();
  await waitFor(async () => expect((await tuneRow(user))?.textContent).toBe("Tune…temp 0.2 · top_p 0.5 · top_k 12 +2"));
  await user.keyboard("{Escape}");
  act(() => fake.emitOptionsSaved({ model: "qwen3:8b", saved: {} }));
  await waitFor(async () => expect((await tuneRow(user))?.textContent).toBe("Tune…top_k 12 · min_p 0.1 · repeat_penalty 1.3"));
});

test("no dot and no Tune… when nothing changed", async () => {
  const none = await setup("ollama", { num_ctx: 8192 });
  await vi.waitFor(() => expect(none.raw.getModelOptions).toHaveBeenCalled());
  await wait();
  expect(dot()).toBeNull();
  expect(await tuneRow(userEvent.setup())).toBeNull();
});

test("a hosted model has no dot and no options read", async () => {
  const fake = await setup("anthropic");
  await wait();
  expect(dot()).toBeNull();
  expect(fake.raw.getModelOptions).not.toHaveBeenCalled();
});
