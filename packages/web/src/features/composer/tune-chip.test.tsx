import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { closeModelDialog } from "../models/index.ts";
import { sampleOptionsResult } from "../models/sample-tune.ts";
import { SAMPLE_LISTING } from "../models/sample.ts";
import { TuneChipView } from "./tune-chip.tsx";

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

const chip = () => screen.queryByRole("button", { name: /^Changed options: / });

test("the chip names the changed values, leaves out num_ctx, and opens the Tune view of the session's model", async () => {
  const fake = await setup("ollama");
  await waitFor(() => expect(chip()?.textContent).toBe("temp 0.2 · top_p 0.5"));
  expect(fake.raw.getModelOptions).toHaveBeenCalledWith("qwen3:8b", "a");
  await userEvent.setup().click(chip() as HTMLElement);
  expect(await screen.findByRole("heading", { name: "Tune Qwen3 8B" })).toBeTruthy();
});

test("a session override and a save from another client change the chip", async () => {
  const fake = await setup("ollama");
  await waitFor(() => expect(chip()?.textContent).toBe("temp 0.2 · top_p 0.5"));
  act(() => fake.emitEvent(ev("a", "model.options.changed", { options: { top_k: 12, min_p: 0.1, repeat_penalty: 1.3 } })));
  await waitFor(() => expect(chip()?.textContent).toBe("temp 0.2 · top_p 0.5 · top_k 12 +2"));
  act(() => fake.emitOptionsSaved({ model: "qwen3:8b", saved: {} }));
  await waitFor(() => expect(chip()?.textContent).toBe("top_k 12 · min_p 0.1 · repeat_penalty 1.3"));
});

test("no chip when nothing changed, and none on a hosted model", async () => {
  const none = await setup("ollama", { num_ctx: 8192 });
  await vi.waitFor(() => expect(none.raw.getModelOptions).toHaveBeenCalled());
  await wait();
  expect(chip()).toBeNull();
});

test("a hosted model has no chip and no options read", async () => {
  const fake = await setup("anthropic");
  await wait();
  expect(chip()).toBeNull();
  expect(fake.raw.getModelOptions).not.toHaveBeenCalled();
});

for (const theme of ["slip", "kiln"]) {
  test(`the chip passes axe in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    render(<TuneChipView text="temp 0.2 · top_p 0.9" onOpen={() => {}} />);
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
}
