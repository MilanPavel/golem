import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { GetModelsPage } from "./get-models-page.tsx";
import { HF_FILES, HF_RESULTS, LIBRARY_RESULTS, NO_ACTIONS, NO_PULLS, SAMPLE_LISTING } from "./models-sample.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** jsdom has no layout: say how wide every pane measures. */
function paneWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
}

function hfPage(onBack: () => void = () => undefined) {
  const hf = { search: () => Promise.resolve(HF_RESULTS), files: () => Promise.resolve(HF_FILES) };
  return <GetModelsPage listing={SAMPLE_LISTING} pulls={NO_PULLS} onPull={() => Promise.resolve()} onStop={() => Promise.resolve()} hf={hf} library={NO_ACTIONS.library} onBack={onBack} initialTab="hf" initialHf={{ results: HF_RESULTS }} />;
}

function libraryPage(onBack: () => void = () => undefined) {
  return (
    <GetModelsPage
      listing={SAMPLE_LISTING}
      pulls={NO_PULLS}
      onPull={() => Promise.resolve()}
      onStop={() => Promise.resolve()}
      hf={NO_ACTIONS.hf}
      library={NO_ACTIONS.library}
      onBack={onBack}
      initialTab="lib"
      initialLibrary={{ results: LIBRARY_RESULTS }}
    />
  );
}

const SIZES = { name: `Sizes of ${HF_FILES.repo}` };

test("beside the list, the detail is there at once, the first repo is chosen, and Esc leaves for Ollama", async () => {
  paneWidth(1000);
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(hfPage(onBack));
  expect(await screen.findByRole("group", SIZES)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back to repos" })).toBeNull();
  const rows = screen.getAllByRole("button", { name: /Qwen3.8-27B-Instruct-GGUF/ });
  expect(rows[0]?.getAttribute("aria-current")).toBe("true");
  await user.keyboard("{Escape}");
  expect(onBack).toHaveBeenCalledTimes(1);
});

test("in a narrow pane the list has all of it, nothing is opened, and a picked repo opens the detail with a way back", async () => {
  paneWidth(400);
  const user = userEvent.setup();
  render(hfPage());
  const list = screen.getByRole("list", { name: "Hugging Face repos" });
  expect(list).toBeTruthy();
  expect(screen.queryByRole("group", SIZES)).toBeNull();
  expect(screen.queryByRole("button", { name: "Back to repos" })).toBeNull();
  expect(screen.queryAllByRole("button", { current: true })).toHaveLength(0);
  await user.click(screen.getAllByRole("button", { name: /Qwen3.8-27B-Instruct-GGUF/ })[1] as HTMLElement);
  expect(await screen.findByRole("group", { name: "Sizes of bartowski/Qwen3.8-27B-Instruct-GGUF" })).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Hugging Face repos" })).toBeNull();
  // The heading has the focus, so a screen reader starts on the repo.
  expect(document.activeElement?.tagName).toBe("H4");
  expect(document.activeElement?.textContent).toBe("Qwen3.8-27B-Instruct-GGUF");
  await user.click(screen.getByRole("button", { name: "Back to repos" }));
  expect(screen.getByRole("list", { name: "Hugging Face repos" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: /^Sizes of/ })).toBeNull();
  // The row that was picked has the focus again.
  const picked = screen.getByRole("button", { current: true });
  expect(document.activeElement).toBe(picked);
  expect(picked.textContent).toContain("bartowski");
});

test("in a narrow pane Esc goes from the detail to the list, then to Ollama", async () => {
  paneWidth(400);
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(hfPage(onBack));
  await user.click(screen.getAllByRole("button", { name: /Qwen3.8-27B-Instruct-GGUF/ })[0] as HTMLElement);
  await screen.findByRole("group", SIZES);
  await user.keyboard("{Escape}");
  expect(onBack).not.toHaveBeenCalled();
  expect(screen.getByRole("list", { name: "Hugging Face repos" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { current: true }));
  await user.keyboard("{Escape}");
  expect(onBack).toHaveBeenCalledTimes(1);
});

test("the Ollama library does the same: the list, then a name with a way back, and Esc steps back", async () => {
  paneWidth(400);
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(libraryPage(onBack));
  expect(screen.getByRole("list", { name: "Ollama library names" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: /^Sizes of/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: /qwen3.8/ }));
  expect(screen.getByRole("group", { name: "Sizes of qwen3.8" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Back to names" })).toBeTruthy();
  expect(document.activeElement?.textContent).toBe("qwen3.8");
  await user.keyboard("{Escape}");
  expect(onBack).not.toHaveBeenCalled();
  await waitFor(() => {
    expect(screen.getByRole("list", { name: "Ollama library names" })).toBeTruthy();
  });
  await user.keyboard("{Escape}");
  expect(onBack).toHaveBeenCalledTimes(1);
});

test("the Ollama library beside its detail still chooses the first name", () => {
  paneWidth(1000);
  render(libraryPage());
  expect(screen.getByRole("group", { name: "Sizes of gemma4" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back to names" })).toBeNull();
});
