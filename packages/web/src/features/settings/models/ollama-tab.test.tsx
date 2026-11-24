import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { expect, test, vi } from "vitest";
import type { OllamaLibraryResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { LIBRARY_RESULTS, NO_ACTIONS, NO_PULLS, SAMPLE_LISTING } from "./models-sample.ts";
import { useLibraryList, type OllamaLibraryActions, type OllamaLibraryInitial } from "./ollama-library.ts";
import { OllamaLibraryTab } from "./ollama-tab.tsx";
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

function actions(search: OllamaLibraryActions["search"]) {
  return { search: vi.fn(search) };
}

const whole = (query: string): Promise<OllamaLibraryResult> => Promise.resolve(query === "" ? LIBRARY_RESULTS : { models: [] });

type HostProps = {
  library: OllamaLibraryActions;
  timer?: Timer;
  pulls?: PullsSnapshot;
  pull?: (ref: string) => Promise<boolean>;
  onHuggingFace?: () => void;
  initial?: OllamaLibraryInitial;
  search?: string;
  strict?: boolean;
};

function Host({ library, timer, pulls = NO_PULLS, pull = () => Promise.resolve(true), onHuggingFace = () => undefined, initial, search = "", strict = false }: HostProps) {
  const [text, setText] = useState(search);
  const list = useLibraryList(library, initial);
  const tab = (
    <OllamaLibraryTab
      library={library}
      list={list}
      listing={SAMPLE_LISTING}
      pulls={pulls}
      pull={pull}
      onStop={() => undefined}
      failure={null}
      search={text}
      onHuggingFace={onHuggingFace}
      {...(timer === undefined ? {} : { timer })}
      {...(initial === undefined ? {} : { initial })}
    />
  );
  return (
    <>
      <input
        aria-label="Search"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {strict ? <StrictMode>{tab}</StrictMode> : tab}
    </>
  );
}

const names = () => within(screen.getByRole("list", { name: "Ollama library names" })).getAllByRole("listitem");

test("it opens on the whole list with the first name chosen, and typing filters it without a call", async () => {
  const user = userEvent.setup();
  const library = actions(whole);
  render(<Host library={library} timer={stepTimer().timer} />);
  await screen.findByRole("list", { name: "Ollama library names" });
  expect(library.search).toHaveBeenCalledTimes(1);
  expect(library.search).toHaveBeenLastCalledWith("");
  expect(names()).toHaveLength(LIBRARY_RESULTS.models.length);
  expect(names()[0]?.textContent).toContain("4 sizes · from 4.6 GB");
  expect(screen.getByRole("group", { name: "Sizes of gemma4" })).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "Search" }), "mistral");
  expect(names().map((row) => row.querySelector(".break-words")?.textContent)).toEqual(["mistral", "mistral-small3.2", "mistral-nemo", "mistral-large"]);
  expect(library.search).toHaveBeenCalledTimes(1);
  // The name that was typed is the one chosen.
  expect(screen.getByRole("heading", { name: "mistral" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Open on ollama.com/ }).getAttribute("href")).toBe("https://ollama.com/library/mistral");
  expect(screen.getByText("Mistral 7B, the small classic.")).toBeTruthy();
});

test("a click chooses another name, and name:tag chooses that name", async () => {
  const user = userEvent.setup();
  render(<Host library={actions(whole)} timer={stepTimer().timer} />);
  await screen.findByRole("list", { name: "Ollama library names" });
  await user.click(within(screen.getByRole("list", { name: "Ollama library names" })).getByRole("button", { name: /llama3.3/ }));
  expect(screen.getByRole("group", { name: "Sizes of llama3.3" })).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "Search" }), "deepseek-r1:8b");
  expect(screen.getByRole("group", { name: "Sizes of deepseek-r1" })).toBeTruthy();
});

test("a size downloads with the ollama/ name, the recommended one is marked, and a too big size still downloads", async () => {
  const user = userEvent.setup();
  const pull = vi.fn(() => Promise.resolve(true));
  render(<Host library={actions(whole)} timer={stepTimer().timer} pull={pull} search="gpt-oss" />);
  const sizes = await screen.findByRole("group", { name: "Sizes of gpt-oss" });
  const rows = within(sizes).getAllByRole("listitem");
  expect(rows[0]?.textContent).toContain("RECOMMENDED");
  expect(rows[0]?.textContent).toContain("gpt-oss:20b");
  await user.click(within(sizes).getByRole("button", { name: "Download gpt-oss:20b" }));
  expect(pull).toHaveBeenCalledWith("ollama/gpt-oss:20b");
  expect(within(sizes).getByRole("button", { name: "Download gpt-oss:120b" }).textContent).toBe("Download anyway");
});

test("an installed size says Installed, and a download shows its progress in the row", async () => {
  const pulls: PullsSnapshot = { active: new Map([["ollama/qwen3.8:9b", { track: { completed: 3e9, total: 6e9, samples: [] }, status: "pulling", progress: null }]]), failed: new Map() };
  render(<Host library={actions(whole)} timer={stepTimer().timer} pulls={pulls} search="qwen3.8" />);
  const sizes = await screen.findByRole("group", { name: "Sizes of qwen3.8" });
  expect(within(sizes).getByText("Installed")).toBeTruthy();
  expect(within(sizes).getByRole("progressbar", { name: "Downloading qwen3.8:9b" })).toBeTruthy();
});

test("a name outside the list is asked of the daemon after the typing rests, says so meanwhile, and shows as one entry", async () => {
  const user = userEvent.setup();
  const { timer, pause } = stepTimer();
  const found: OllamaLibraryResult = { models: [{ name: "my-tune", blurb: "", sizes: [{ tag: "7b", size_gb: 4.1, fit: "fits", recommended: true, installed: false }] }] };
  const library = actions((query) => Promise.resolve(query === "" ? LIBRARY_RESULTS : found));
  render(<Host library={library} timer={timer} />);
  await screen.findByRole("list", { name: "Ollama library names" });
  await user.type(screen.getByRole("textbox", { name: "Search" }), "my-tune:7b");
  // Nothing is asked while the typing goes on, the old list stays and a quiet line says what happens next.
  expect(library.search).toHaveBeenCalledTimes(1);
  expect(screen.getByText("checking the Ollama library…")).toBeTruthy();
  // The names that matched before stay.
  expect(names().length).toBeGreaterThan(1);
  pause();
  await waitFor(() => expect(library.search).toHaveBeenLastCalledWith("my-tune:7b"));
  expect(await screen.findByRole("group", { name: "Sizes of my-tune" })).toBeTruthy();
  expect(names()).toHaveLength(1);
  expect(screen.queryByText("checking the Ollama library…")).toBeNull();
});

test("a missing name says so without an error, and the button runs the same search on Hugging Face", async () => {
  const user = userEvent.setup();
  const { timer, pause } = stepTimer();
  const onHuggingFace = vi.fn();
  render(<Host library={actions(whole)} timer={timer} onHuggingFace={onHuggingFace} />);
  await screen.findByRole("list", { name: "Ollama library names" });
  await user.type(screen.getByRole("textbox", { name: "Search" }), "mistrall");
  pause();
  expect(await screen.findByText("No “mistrall” in the Ollama library")).toBeTruthy();
  expect(screen.getByText(/Check the spelling/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Search Hugging Face for “mistrall”" }));
  expect(onHuggingFace).toHaveBeenCalledTimes(1);
});

test("an error from the registry shows its words and the old list stays", async () => {
  const user = userEvent.setup();
  const { timer, pause } = stepTimer();
  const library = actions((query) => (query === "" ? Promise.resolve(LIBRARY_RESULTS) : Promise.reject(new Error("The Ollama registry didn't answer. Try again in a moment."))));
  render(<Host library={library} timer={timer} />);
  await screen.findByRole("list", { name: "Ollama library names" });
  await user.type(screen.getByRole("textbox", { name: "Search" }), "my-tune");
  pause();
  expect((await screen.findByRole("alert")).textContent).toBe("The Ollama registry didn't answer. Try again in a moment.");
  expect(names().length).toBeGreaterThan(1);
});

test("a state to start in survives strict mode, the pause and the no-op actions of the gallery", async () => {
  vi.useFakeTimers();
  try {
    const library = NO_ACTIONS.library;
    const search = vi.spyOn(library, "search");
    render(<Host library={library} strict initial={{ results: LIBRARY_RESULTS, chosen: "qwen3.8" }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(search).not.toHaveBeenCalled();
    expect(names()).toHaveLength(LIBRARY_RESULTS.models.length);
    const sizes = screen.getByRole("group", { name: "Sizes of qwen3.8" });
    expect(within(sizes).getAllByRole("listitem").map((row) => row.querySelector("b")?.textContent)).toEqual(["4b", "9b", "27b"]);
  } finally {
    vi.useRealTimers();
  }
});

test("a seeded name outside the list keeps its entry in strict mode", async () => {
  vi.useFakeTimers();
  try {
    const library = NO_ACTIONS.library;
    const search = vi.spyOn(library, "search");
    const found: OllamaLibraryResult = { models: [{ name: "my-tune", blurb: "", sizes: [{ tag: "7b", size_gb: 4.1, fit: "fits", recommended: true, installed: false }] }] };
    render(<Host library={library} strict search="my-tune:7b" initial={{ results: LIBRARY_RESULTS, found: { query: "my-tune:7b", results: found } }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(search).not.toHaveBeenCalled();
    expect(names()).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Sizes of my-tune" })).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});
