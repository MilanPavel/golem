import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import type { HfFilesResult, HfSearchResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { HuggingFaceTab, type HfActions } from "./hf-tab.tsx";
import { HF_FILES, HF_RESULTS, NO_PULLS, SAMPLE_LISTING } from "./models-sample.ts";
import type { Timer } from "./use-debounced.ts";

/** A timer that only moves when the test says so. */
function stepTimer() {
  const waiting = new Map<number, () => void>();
  let next = 0;
  const timer: Timer = {
    set: (run) => {
      next += 1;
      waiting.set(next, run);
      return next;
    },
    clear: (handle) => {
      waiting.delete(handle as number);
    },
  };
  return {
    timer,
    pause: () => {
      act(() => {
        for (const run of [...waiting.values()]) run();
        waiting.clear();
      });
    },
  };
}

function actions(search: HfActions["search"], files: HfActions["files"] = () => Promise.resolve(HF_FILES)): HfActions & { search: ReturnType<typeof vi.fn>; files: ReturnType<typeof vi.fn> } {
  return { search: vi.fn(search), files: vi.fn(files) };
}

type HostProps = { hf: HfActions; timer: Timer; pulls?: PullsSnapshot; pull?: (ref: string) => Promise<boolean>; listing?: typeof SAMPLE_LISTING };

function Host({ hf, timer, pulls = NO_PULLS, pull = () => Promise.resolve(true), listing = SAMPLE_LISTING }: HostProps) {
  const [search, setSearch] = useState("");
  return (
    <>
      <input aria-label="Search" value={search} onChange={(event) => { setSearch(event.target.value); }} />
      <HuggingFaceTab hf={hf} listing={listing} pulls={pulls} pull={pull} onStop={() => undefined} failure={null} search={search} onSearch={setSearch} timer={timer} />
    </>
  );
}

const ONE = (id: string): HfSearchResult => ({ repos: [{ id, downloads: 10, likes: 1, updated: null, gated: false }] });

test("it opens on the popular repos with the first chosen, then searches after the typing rests", async () => {
  const user = userEvent.setup();
  const { timer, pause } = stepTimer();
  const hf = actions((query) => Promise.resolve(query === "" ? HF_RESULTS : ONE("acme/Tiny-7B-GGUF")));
  render(<Host hf={hf} timer={timer} />);
  await screen.findByRole("list", { name: "Hugging Face repos" });
  expect(hf.search).toHaveBeenCalledTimes(1);
  expect(hf.search).toHaveBeenLastCalledWith("");
  expect(hf.files).toHaveBeenCalledWith(HF_FILES.repo);
  await user.type(screen.getByRole("textbox", { name: "Search" }), "tiny");
  expect(hf.search).toHaveBeenCalledTimes(1);
  pause();
  await waitFor(() => expect(hf.search).toHaveBeenLastCalledWith("tiny"));
  expect((await screen.findAllByText("Tiny-7B-GGUF")).length).toBeGreaterThan(0);
  expect(screen.getAllByText("7B").length).toBeGreaterThan(0);
});

test("the sizes have plain names, the recommended one is marked, and a size that is too big still downloads", async () => {
  const user = userEvent.setup();
  const pull = vi.fn(() => Promise.resolve(true));
  render(<Host hf={actions(() => Promise.resolve(HF_RESULTS))} timer={stepTimer().timer} pull={pull} />);
  const sizes = await screen.findByRole("group", { name: `Sizes of ${HF_FILES.repo}` });
  const rows = within(sizes).getAllByRole("listitem");
  expect(rows.map((row) => row.querySelector("b")?.textContent)).toEqual(["Small", "Balanced", "Large", "Largest", "F16"]);
  expect(rows[1]?.textContent).toContain("Q4_K_M");
  expect(rows[1]?.textContent).toContain("RECOMMENDED");
  expect(rows[1]?.textContent).toContain("The usual pick");
  expect(within(rows[1] as HTMLElement).getByRole("button", { name: "Download Q4_K_M" }).className).toContain("bg-clay");
  expect(within(rows[3] as HTMLElement).getByText("Tight · slower")).toBeTruthy();
  await user.click(within(sizes).getByRole("button", { name: "Download F16" }));
  expect(pull).toHaveBeenCalledWith(`ollama/hf.co/${HF_FILES.repo}:F16`);
  expect(screen.getByRole("button", { name: "Download F16" }).textContent).toBe("Download anyway");
});

test("a download shows its progress in the size's row, and an installed size says so", async () => {
  const ref = `ollama/hf.co/${HF_FILES.repo}:Q6_K`;
  const pulls: PullsSnapshot = { active: new Map([[ref, { track: { completed: 5e9, total: 20e9, samples: [] }, status: "pulling", progress: null }]]), failed: new Map() };
  const listing = { ...SAMPLE_LISTING, models: [...SAMPLE_LISTING.models, { ...SAMPLE_LISTING.models[0], ref: `ollama/hf.co/${HF_FILES.repo}:Q3_K_M`, source: "installed" as const, status: "ready" as const }] };
  render(<Host hf={actions(() => Promise.resolve(HF_RESULTS))} timer={stepTimer().timer} pulls={pulls} listing={listing as typeof SAMPLE_LISTING} />);
  const sizes = await screen.findByRole("group", { name: `Sizes of ${HF_FILES.repo}` });
  expect(within(sizes).getByRole("progressbar", { name: "Downloading Q6_K" })).toBeTruthy();
  expect(within(sizes).getByText("25%")).toBeTruthy();
  expect(within(sizes).getByText("Installed")).toBeTruthy();
});

test("when no size fits, a line says so and the buttons stay", async () => {
  const big: HfFilesResult = { repo: HF_FILES.repo, sizes: [{ quant: "Q8_0", size_gb: 80, files: 2, fit: "too_big", recommended: false }, { quant: "Q4_K_M", size_gb: 70, files: 2, fit: "too_big", recommended: false }] };
  render(<Host hf={actions(() => Promise.resolve(HF_RESULTS), () => Promise.resolve(big))} timer={stepTimer().timer} />);
  expect(await screen.findByText(/Every size is bigger than this Mac's 64 GB/)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /^Download Q/ })).toHaveLength(2);
});

test("a repo that needs a token can be chosen and says what to do, and asks for no sizes", async () => {
  const user = userEvent.setup();
  const hf = actions(() => Promise.resolve(HF_RESULTS));
  render(<Host hf={hf} timer={stepTimer().timer} />);
  await user.click(await screen.findByRole("button", { name: /Llama-4-Scout/ }));
  expect(await screen.findByText(/meta-llama asks you to accept its terms/)).toBeTruthy();
  expect(screen.getByText(/Search for “Llama-4-Scout”/)).toBeTruthy();
  expect(hf.files).not.toHaveBeenCalledWith("meta-llama/Llama-4-Scout-GGUF");
  expect(screen.queryByRole("group", { name: /Sizes of/ })).toBeNull();
});

test("no result says so and offers the searches to try", async () => {
  const user = userEvent.setup();
  const { timer, pause } = stepTimer();
  render(<Host hf={actions((query) => Promise.resolve(query === "" ? HF_RESULTS : { repos: [] }))} timer={timer} />);
  await screen.findByRole("list", { name: "Hugging Face repos" });
  await user.type(screen.getByRole("textbox", { name: "Search" }), "zzzz");
  pause();
  expect(await screen.findByText("Hugging Face has no GGUF repos for “zzzz”")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "gemma" }));
  expect((screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement).value).toBe("gemma");
});

test("an error shows its words and the old results stay", async () => {
  const user = userEvent.setup();
  const { timer, pause } = stepTimer();
  render(<Host hf={actions((query) => (query === "" ? Promise.resolve(HF_RESULTS) : Promise.reject(new Error("Hugging Face did not answer."))))} timer={timer} />);
  await screen.findByRole("list", { name: "Hugging Face repos" });
  await user.type(screen.getByRole("textbox", { name: "Search" }), "qwen");
  pause();
  expect((await screen.findByRole("alert")).textContent).toBe("Hugging Face did not answer.");
  expect(within(screen.getByRole("list", { name: "Hugging Face repos" })).getAllByRole("listitem")).toHaveLength(3);
});
