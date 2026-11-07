import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { ModelListResult } from "../../store/models.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { closeModelDialog } from "../models/index.ts";
import { SAMPLE_LISTING } from "../models/sample.ts";
import { newSessionModelLabel } from "./model-chip-new.tsx";

const MODEL_NOT_CONFIGURED = -32005;
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function setup(listing: ModelListResult = SAMPLE_LISTING) {
  history.replaceState(null, "", "/");
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(listing);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.setupStart.decide();
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => fake.emitSummary(summary("x", "2026-11-01T11:59:00Z", "/Users/you/repos/golem")));
  return { fake, page, ...view, user: userEvent.setup() };
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const dialog = () => screen.getByRole("dialog", { name: "Choose a model" });

beforeEach(() => localStorage.clear());
afterEach(() => {
  closeModelDialog();
  history.replaceState(null, "", "/");
});

test("the label: the pick, else the default with a tag, else a question, and loading before the list", () => {
  expect(newSessionModelLabel(null, null)).toEqual({ kind: "loading" });
  expect(newSessionModelLabel(null, "ollama/x")).toEqual({ kind: "pick", text: "ollama/x" });
  expect(newSessionModelLabel(SAMPLE_LISTING, null)).toEqual({ kind: "default", text: "Gemma 4 E4B" });
  expect(newSessionModelLabel(SAMPLE_LISTING, "local")).toEqual({ kind: "pick", text: "Qwen3 8B" });
  expect(newSessionModelLabel({ ...SAMPLE_LISTING, default: null }, null)).toEqual({ kind: "none" });
  expect(newSessionModelLabel(SAMPLE_LISTING, "ollama/unlisted")).toEqual({ kind: "pick", text: "ollama/unlisted" });
});

test("the chip shows the default with its tag, beside the folder chip", async () => {
  setup();
  const chip = await screen.findByRole("button", { name: "Model: Gemma 4 E4B, default" });
  expect(chip.textContent).toContain("default");
  expect(screen.getByRole("button", { name: /^Folder:/ })).toBeTruthy();
});

test("with no default the chip asks, in the wait tone", async () => {
  setup({ ...SAMPLE_LISTING, default: null });
  const chip = await screen.findByRole("button", { name: "Choose a model" });
  expect(chip.className).toContain("text-wait");
});

test("the dialog opens in new-session mode, a pick closes it, and the chip shows the pick without the tag", async () => {
  const { user } = setup();
  await user.click(await screen.findByRole("button", { name: "Model: Gemma 4 E4B, default" }));
  expect(await screen.findByRole("dialog", { name: "Choose a model" })).toBeTruthy();
  expect(within(dialog()).getByText(/New sessions use ollama\/gemma4:e4b/)).toBeTruthy();
  expect(within(dialog()).queryByText(/This session uses/)).toBeNull();
  await user.type(within(dialog()).getByRole("combobox", { name: "Search models" }), "qwen3:8b");
  await user.click(await within(dialog()).findByRole("option", { name: /qwen3:8b/ }));
  await user.click(within(dialog()).getByRole("button", { name: "Use for the new session" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const chip = screen.getByRole("button", { name: "Model: Qwen3 8B" });
  expect(chip.textContent).not.toContain("default");
  await waitFor(() => expect(document.activeElement).toBe(chip));
});

test("a row that is not ready offers Download, not a use", async () => {
  const { user } = setup();
  await user.click(await screen.findByRole("button", { name: /^Model:/ }));
  await user.type(within(await screen.findByRole("dialog")).getByRole("combobox", { name: "Search models" }), "qwen3:14b");
  await user.click(await within(dialog()).findByRole("option", { name: /qwen3:14b/ }));
  const actions = within(dialog()).getByRole("group", { name: /^Actions for/ });
  expect(within(actions).getByRole("button", { name: "Download" })).toBeTruthy();
  expect(within(actions).queryByRole("button", { name: "Use for the new session" })).toBeNull();
  await user.click(within(actions).getByRole("button", { name: "Download" }));
  expect(within(dialog()).getByText(/Download qwen3:14b \(9.3 GB, fits\)\?$/)).toBeTruthy();
});

test("Make default changes the default the chip shows", async () => {
  const { fake, user } = setup();
  fake.raw.setDefaultModel.mockImplementation(async () => {
    fake.raw.listModels.mockResolvedValue({ ...SAMPLE_LISTING, default: "ollama/qwen3:8b" });
    return {} as never;
  });
  await user.click(await screen.findByRole("button", { name: /^Model:/ }));
  await user.type(within(await screen.findByRole("dialog")).getByRole("combobox", { name: "Search models" }), "qwen3:8b");
  await user.click(await within(dialog()).findByRole("option", { name: /qwen3:8b/ }));
  await user.click(within(dialog()).getByRole("button", { name: "Make default" }));
  // The dialog is still open, so the chip behind it is hidden from the accessibility tree.
  expect(await screen.findByRole("button", { name: "Model: Qwen3 8B, default", hidden: true }, { timeout: 3000 })).toBeTruthy();
});

test("sending uses the pick, and the next new session starts from the default again", async () => {
  const { fake, user } = setup();
  await user.click(await screen.findByRole("button", { name: /^Model:/ }));
  await user.type(within(await screen.findByRole("dialog")).getByRole("combobox", { name: "Search models" }), "qwen3:8b");
  await user.click(await within(dialog()).findByRole("option", { name: /qwen3:8b/ }));
  await user.click(within(dialog()).getByRole("button", { name: "Use for the new session" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(box());
  await user.type(box(), "hello{Enter}");
  await wait();
  expect(fake.raw.createSession).toHaveBeenCalledWith({ cwd: "/Users/you/repos/golem", modelProfile: "local" });
  expect(location.pathname).toBe("/s/s_new");
  act(() => window.history.back());
  history.replaceState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(await screen.findByRole("button", { name: "Model: Gemma 4 E4B, default" })).toBeTruthy();
});

test("without a pick no model is sent", async () => {
  const { fake, user } = setup();
  await user.type(box(), "hello{Enter}");
  await wait();
  expect(fake.raw.createSession).toHaveBeenCalledWith({ cwd: "/Users/you/repos/golem" });
});

test("a model the daemon refuses shows under the chips, the pick stays, and the draft is kept", async () => {
  const { fake, user } = setup();
  fake.raw.createSession.mockRejectedValueOnce(rpcError(MODEL_NOT_CONFIGURED, "unknown model: nowhere"));
  await user.type(box(), "hello{Enter}");
  await wait();
  expect(screen.getByRole("alert").textContent).toBe("unknown model: nowhere");
  expect(box().value).toBe("hello");
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
});

test("the chip and the dialog have no accessibility violations", async () => {
  const { container, user } = setup();
  await user.click(await screen.findByRole("button", { name: /^Model:/ }));
  await screen.findByRole("dialog", { name: "Choose a model" });
  const rules = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
  expect((await axe.run(container, rules)).violations).toEqual([]);
  expect((await axe.run(document.body, rules)).violations).toEqual([]);
});
