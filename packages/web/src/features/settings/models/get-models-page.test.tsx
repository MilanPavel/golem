import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { ModelListResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { GetModelsPage } from "./get-models-page.tsx";
import { GET_CASES, NO_ACTIONS, NO_PULLS } from "./models-sample.ts";

const FIRST = GET_CASES[0];
if (FIRST?.props.listing == null) throw new Error("The first case has a listing.");
const LISTING: ModelListResult = FIRST.props.listing;

function page(listing: ModelListResult, pulls: PullsSnapshot = NO_PULLS) {
  return <GetModelsPage listing={listing} pulls={pulls} onPull={() => Promise.resolve()} onStop={() => Promise.resolve()} hf={NO_ACTIONS.hf} library={NO_ACTIONS.library} onBack={() => undefined} />;
}

function rowOf(name: string): HTMLElement {
  const found = within(screen.getByRole("list", { name: "Models for this Mac" }))
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(name));
  if (found === undefined) throw new Error(`No line for ${name}.`);
  return found;
}

test("a line goes from Download to progress to Installed without the page closing", () => {
  const ref = "ollama/gemma4:12b";
  const running: PullsSnapshot = {
    active: new Map([[ref, { track: { completed: 4e9, total: 8e9, samples: [] }, status: "pulling", progress: null }]]),
    failed: new Map(),
  };
  const { rerender } = render(page(LISTING));
  expect(within(rowOf("gemma4:12b")).getByRole("button", { name: "Download gemma4:12b" })).toBeTruthy();
  rerender(page(LISTING, running));
  expect(within(rowOf("gemma4:12b")).getByText("50%")).toBeTruthy();
  const installed = { ...LISTING, models: LISTING.models.map((model) => (model.ref === ref ? { ...model, source: "installed" as const, status: "ready" as const } : model)) };
  rerender(page(installed));
  expect(within(rowOf("gemma4:12b")).getByText("Installed")).toBeTruthy();
  // Installed, so the recommended card is gone.
  expect(screen.queryByRole("group", { name: "Recommended for this Mac" })).toBeNull();
});

test("a download that cannot start says why, and the page stays", async () => {
  const user = userEvent.setup();
  const onPull = vi.fn(() => Promise.reject(new Error("Ollama is not running.")));
  render(<GetModelsPage listing={LISTING} pulls={NO_PULLS} onPull={onPull} onStop={() => Promise.resolve()} hf={NO_ACTIONS.hf} library={NO_ACTIONS.library} onBack={() => undefined} />);
  await user.click(screen.getByRole("button", { name: "Download gpt-oss:120b" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Ollama is not running.");
});

const GEMMA = "ollama/gemma4:12b";
const running = (completed: number): PullsSnapshot => ({
  active: new Map([[GEMMA, { track: { completed, total: 8e9, samples: [] }, status: "pulling", progress: null }]]),
  failed: new Map(),
});

function tray(): HTMLElement {
  return screen.getByRole("list", { name: "Downloads" });
}

test("with no download the foot is one quiet line", () => {
  render(page(LISTING));
  expect(screen.getByText("Downloads show up here. They keep going when you leave.")).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Downloads" })).toBeNull();
});

test("a running download shows its numbers in the tray, and Cancel stops it", async () => {
  const user = userEvent.setup();
  const onStop = vi.fn(() => Promise.resolve());
  render(<GetModelsPage listing={LISTING} pulls={running(2.6e9)} onPull={() => Promise.resolve()} onStop={onStop} hf={NO_ACTIONS.hf} library={NO_ACTIONS.library} onBack={() => undefined} />);
  expect(within(tray()).getByText("32% · 2.6 of 8.0 GB")).toBeTruthy();
  await user.click(within(tray()).getByRole("button", { name: "Cancel the download of gemma4:12b" }));
  expect(onStop).toHaveBeenCalledWith(GEMMA);
});

test("a finished download says Ready, Show in Ollama goes back, and dismiss removes the row", async () => {
  const user = userEvent.setup();
  const onBack = vi.fn();
  const view = (pulls: PullsSnapshot) => <GetModelsPage listing={LISTING} pulls={pulls} onPull={() => Promise.resolve()} onStop={() => Promise.resolve()} hf={NO_ACTIONS.hf} library={NO_ACTIONS.library} onBack={onBack} />;
  const { rerender } = render(view(running(7.9e9)));
  rerender(view(NO_PULLS));
  expect(within(tray()).getByText("✓ Ready")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("gemma4:12b is ready.");
  await user.click(within(tray()).getByRole("button", { name: "Show in Ollama" }));
  expect(onBack).toHaveBeenCalled();
  await user.click(within(tray()).getByRole("button", { name: "Dismiss gemma4:12b" }));
  expect(screen.queryByRole("list", { name: "Downloads" })).toBeNull();
});

test("a failed download says why, and Try again pulls it again", async () => {
  const user = userEvent.setup();
  const onPull = vi.fn(() => Promise.resolve());
  const failed: PullsSnapshot = { active: new Map(), failed: new Map([[GEMMA, "no space left on the disk"]]) };
  render(<GetModelsPage listing={LISTING} pulls={failed} onPull={onPull} onStop={() => Promise.resolve()} hf={NO_ACTIONS.hf} library={NO_ACTIONS.library} onBack={() => undefined} />);
  expect(within(tray()).getByText("Failed: no space left on the disk")).toBeTruthy();
  await user.click(within(tray()).getByRole("button", { name: "Try again" }));
  expect(onPull).toHaveBeenCalledWith(GEMMA);
  await user.click(within(tray()).getByRole("button", { name: "Dismiss gemma4:12b" }));
  expect(screen.queryByRole("list", { name: "Downloads" })).toBeNull();
});

test("a failed download shows its reason, the parts left, and Remove asks to clear them", async () => {
  const user = userEvent.setup();
  const onCleanup = vi.fn(() => Promise.resolve());
  const hfRef = "ollama/hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_S";
  const pulls: PullsSnapshot = {
    active: new Map(),
    failed: new Map([[hfRef, "Hugging Face is missing a file for this model. Try another repo or the Ollama library."]]),
    extra: new Map([[hfRef, { detail: "file does not exist", leftoverGb: 16.2 }]]),
  };
  render(<GetModelsPage listing={LISTING} pulls={pulls} onPull={() => Promise.resolve()} onStop={() => Promise.resolve()} onCleanup={onCleanup} hf={NO_ACTIONS.hf} library={NO_ACTIONS.library} onBack={() => undefined} />);
  const reason = within(tray()).getByText("Failed: Hugging Face is missing a file for this model. Try another repo or the Ollama library.");
  expect(reason.getAttribute("title")).toBe("file does not exist");
  expect(within(tray()).getByText("16.2 GB of this download is still on disk.")).toBeTruthy();
  await user.click(within(tray()).getByRole("button", { name: "Remove what is left of unsloth/Qwen3.8-27B-GGUF:Q4_K_S" }));
  expect(onCleanup).toHaveBeenCalledWith(hfRef);
});

test("after the parts are removed the row stops offering to remove them", () => {
  const pulls: PullsSnapshot = { active: new Map(), failed: new Map([[GEMMA, "boom"]]), extra: new Map([[GEMMA, { detail: null, leftoverGb: null }]]) };
  render(<GetModelsPage listing={LISTING} pulls={pulls} onPull={() => Promise.resolve()} onStop={() => Promise.resolve()} onCleanup={() => Promise.resolve()} hf={NO_ACTIONS.hf} library={NO_ACTIONS.library} onBack={() => undefined} />);
  expect(within(tray()).queryByText(/still on disk/)).toBeNull();
  expect(within(tray()).queryByRole("button", { name: /Remove what is left/ })).toBeNull();
});
