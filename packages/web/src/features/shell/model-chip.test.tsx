import { act, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { ListedModel } from "../../store/models.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { SAMPLE_LISTING } from "../models/sample.ts";
import { ModelChipView } from "./model-chip.tsx";
import { newSessionModelLabel } from "./model-chip-new.tsx";

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

test("pinned shows the chat's model with its profile and provider", async () => {
  await setup();
  expect(chip().getAttribute("aria-label")).toBe("Model: qwen3:27b");
  expect(chip().getAttribute("title")).toBe("local · ollama");
});

test("auto shows the model the ladder starts on, then the model that ran, and a pin brings the chat's model back", async () => {
  const fake = await setup();
  act(() => fake.emitEvent(ev("a", "session.updated", { route: "auto" })));
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Model: auto · llama3.2:3b"));
  expect(chip().getAttribute("title")).toBe("golem picks the model on auto. Choose one to pin this chat.");
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
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Model: auto · qwen3:27b"));
  act(() => fake.emitEvent(ev("a", "session.updated", { route: "pinned" })));
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Model: qwen3:27b"));
});

test("the chip views pass axe", async () => {
  const { container } = render(
    <div>
      <ModelChipView shown={{ name: "qwen3:27b", pick: false }} title="local · ollama" onOpen={() => {}} />
      <ModelChipView shown={{ name: "llama3.2:3b", pick: true }} title="local · ollama" onOpen={() => {}} />
    </div>,
  );
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations).toEqual([]);
});

test("the new-chat label on auto is the model auto starts on; a pick or another route keeps its label", () => {
  const auto = { routing: { mode: "auto", paid: "ask", budget_max_price: 1.5, local_only: [] }, ladder: {} } as never;
  const pinned = { routing: { mode: "pinned", paid: "ask", budget_max_price: 1.5, local_only: [] }, ladder: {} } as never;
  expect(newSessionModelLabel(SAMPLE_LISTING, null, auto)).toMatchObject({ kind: "auto" });
  expect(newSessionModelLabel(SAMPLE_LISTING, null, pinned)).toEqual({ kind: "default", text: "Gemma 4 E4B" });
  expect(newSessionModelLabel(SAMPLE_LISTING, "local", auto)).toEqual({ kind: "pick", text: "Qwen3 8B" });
});
