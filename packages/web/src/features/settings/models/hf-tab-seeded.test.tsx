import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { expect, test, vi } from "vitest";
import { HuggingFaceTab, type HfActions, type HfTabProps } from "./hf-tab.tsx";
import { HF_FILES, HF_RESULTS, NO_PULLS, SAMPLE_LISTING } from "./models-sample.ts";

function actions(search: HfActions["search"]) {
  return { search: vi.fn(search), files: vi.fn(() => Promise.resolve({ repo: "x", sizes: [] })) };
}

function Host({ hf, initial, search = "" }: { hf: HfActions; initial?: HfTabProps["initial"]; search?: string }) {
  const [text, setText] = useState(search);
  return (
    <StrictMode>
      <HuggingFaceTab hf={hf} listing={SAMPLE_LISTING} pulls={NO_PULLS} pull={() => Promise.resolve(true)} onStop={() => undefined} failure={null} search={text} onSearch={setText} {...(initial === undefined ? {} : { initial })} />
      <output aria-label="Field">{text}</output>
    </StrictMode>
  );
}

test("a seeded state survives strict mode, the pause and the no-op actions of the gallery", async () => {
  vi.useFakeTimers();
  try {
    const hf = actions(() => Promise.resolve({ repos: [] }));
    render(<Host hf={hf} search="qwen3.8 27b" initial={{ results: HF_RESULTS, files: HF_FILES }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(hf.search).not.toHaveBeenCalled();
    expect(within(screen.getByRole("list", { name: "Hugging Face repos" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("group", { name: `Sizes of ${HF_FILES.repo}` })).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test("a seeded gated repo shows its note, and its hint puts the name in the search", async () => {
  const user = userEvent.setup();
  const hf = actions(() => Promise.resolve({ repos: [] }));
  render(<Host hf={hf} initial={{ results: HF_RESULTS, chosen: "meta-llama/Llama-4-Scout-GGUF" }} />);
  expect(screen.getByText(/asks you to accept its terms/)).toBeTruthy();
  expect(hf.search).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Search for “Llama-4-Scout”" }));
  expect(screen.getByLabelText("Field").textContent).toBe("Llama-4-Scout");
});

test("an empty answer to an empty search does not quote nothing", async () => {
  render(<Host hf={actions(() => Promise.resolve({ repos: [] }))} />);
  expect(await screen.findByText("Hugging Face returned nothing right now")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "qwen" })).toHaveLength(1);
});
