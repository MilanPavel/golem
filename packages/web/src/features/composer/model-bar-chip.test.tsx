import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { ListedModel } from "../../store/models.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { ModelBarChipView } from "./model-bar-chip.tsx";

const CWD = "/Users/you/repos/golem";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

const model = (ref: string, extra: Partial<ListedModel> = {}): ListedModel => ({
  ref,
  label: ref.slice(ref.indexOf("/") + 1),
  provider: ref.slice(0, ref.indexOf("/")),
  source: "installed",
  status: "ready",
  tier: "local",
  ...extra,
});

const MODELS = [model("ollama/qwen3:27b", { ctx: 32768 }), model("ollama/llama3.2:3b", { ctx: 8192 })];

async function setup() {
  history.replaceState(null, "", "/s/a");
  const fake = fakeClient();
  fake.raw.getConfig.mockResolvedValue({ rules: [], routing: { ladder: { local: "ollama/llama3.2:3b" } } } as never);
  fake.raw.listModels.mockResolvedValue({
    default: "ollama/qwen3:27b",
    models: MODELS,
    providers: [],
    setup: { ollama_installed: true, ollama_running: true, keys: [], default_status: "ready" },
  } as never);
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
  act(() => fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "UTF-8 split", last_seq: 2 }));
  await wait();
  act(() =>
    fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_provider: "ollama", model_name: "qwen3:27b" })),
  );
  await wait();
  return fake;
}

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
});

const chip = () => screen.getByRole("button", { name: /^Model: / });

test("pinned shows the chat's model with its profile and provider, and no route word", async () => {
  await setup();
  expect(chip().getAttribute("aria-label")).toBe("Model: qwen3:27b");
  expect(chip().getAttribute("title")).toBe("qwen3:27b · local · ollama");
  expect(chip().textContent).toBe("qwen3:27b");
});

test("auto shows the model the ladder starts on, then the model that ran, with a muted · auto, and a pin brings the chat's model back", async () => {
  const fake = await setup();
  act(() => fake.emitEvent(ev("a", "session.updated", { route: "auto" })));
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Model: llama3.2:3b, route auto"));
  expect(chip().textContent).toBe("llama3.2:3b· auto");
  expect(chip().getAttribute("title")).toContain("golem picks the model on auto. Choose one to pin this chat.");
  act(() =>
    fake.emitEvent(
      ev("a", "model.routed", {
        model_profile: "ollama/qwen3:27b",
        provider: "ollama",
        model: "qwen3:27b",
        tier: "local",
        reason: "fit",
        detail: "",
        rejected: [],
      }),
    ),
  );
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Model: qwen3:27b, route auto"));
  act(() => fake.emitEvent(ev("a", "session.updated", { route: "local" })));
  await waitFor(() => expect(chip().textContent).toBe("qwen3:27b· local"));
  act(() => fake.emitEvent(ev("a", "session.updated", { route: "pinned" })));
  await waitFor(() => expect(chip().textContent).toBe("qwen3:27b"));
});

test("the menu has the route switch first, and Auto sets the route", async () => {
  const fake = await setup();
  const user = userEvent.setup();
  await user.click(chip());
  const menu = await screen.findByRole("dialog", { name: "Model and route" });
  const radios = within(menu).getAllByRole("radio");
  expect(radios.map((item) => item.textContent)).toEqual(["Pinned", "Local only", "Auto"]);
  expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
  expect(within(menu).getByRole("button", { name: /^Choose a model…/ })).toBeTruthy();
  expect(within(menu).queryByRole("button", { name: /^Tune…/ })).toBeNull();
  await user.click(within(menu).getByRole("radio", { name: "Auto" }));
  expect(fake.raw.setRoute).toHaveBeenCalledWith("a", "auto");
});

test("Choose a model… closes the menu and opens the model dialog", async () => {
  await setup();
  const user = userEvent.setup();
  await user.click(chip());
  await user.click(await screen.findByRole("button", { name: /^Choose a model…/ }));
  expect(await screen.findByRole("dialog", { name: "Choose a model" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Model and route" })).toBeNull();
});

test("the chip views pass axe, open and closed", async () => {
  const view = (open: boolean) => (
    <ModelBarChipView
      name="qwen3.8:27b"
      route="auto"
      tuned="temp 0.2"
      title="qwen3.8:27b · local · ollama"
      label="Model: qwen3.8:27b, route auto, options changed"
      open={open}
      onOpenChange={() => {}}
      panel={<p>Route</p>}
      onChoose={() => {}}
      onTune={() => {}}
    />
  );
  const { container, rerender } = render(view(false));
  expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  expect(container.querySelector("[data-tuned]")).toBeTruthy();
  rerender(view(true));
  const menu = await screen.findByRole("dialog", { name: "Model and route" });
  expect(within(menu).getByRole("button", { name: /^Tune…/ })).toBeTruthy();
  expect((await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
});
