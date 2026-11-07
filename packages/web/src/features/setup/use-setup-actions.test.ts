import type { InstallEvent } from "@golem/view";
import { expect, test, vi } from "vitest";
import { WORKING_LISTING } from "./sample.ts";
import { checkSetupAgain, installLog, runOllamaInstall, startOllamaAndList, type InstallEnd } from "./use-setup-actions.ts";

type Emit = (event: InstallEvent) => void;

/** An install that hands its emitter back, and settles with `result`. */
function install(result: "started" | "no_brew" | Error = "started") {
  let emit: Emit = () => undefined;
  const installOllama = vi.fn(async (onEvent: Emit) => {
    emit = onEvent;
    if (result instanceof Error) throw result;
    return result;
  });
  return { installOllama, emit: (event: InstallEvent) => emit(event) };
}

function watch() {
  const outputs: string[] = [];
  const ends: InstallEnd[] = [];
  return {
    outputs,
    ends,
    handlers: {
      onOutput: (_text: string, tail: { last: string }) => outputs.push(tail.last),
      onEnd: (end: InstallEnd) => ends.push(end),
    },
  };
}

test("the install's output arrives with the newest finished line, and a redrawn line is replaced", async () => {
  const fake = install();
  const seen = watch();
  runOllamaInstall(fake, seen.handlers);
  await vi.waitFor(() => expect(fake.installOllama).toHaveBeenCalled());
  fake.emit({ kind: "output", text: "==> Downloading\n==> Pouring 10%\r==> Pouring 60%\npartial" });
  fake.emit({ kind: "output", text: " rest\n" });
  expect(seen.outputs).toEqual(["==> Pouring 60%", "partial rest"]);
  expect(seen.ends).toEqual([]);
});

test("an install that exits 0 is installed, a non-zero one failed with the last line, and a stopped one stopped", async () => {
  const cases: [InstallEvent, InstallEnd][] = [
    [{ kind: "exit", code: 0, stopped: false }, { outcome: "installed", reason: "Error: no space left" }],
    [{ kind: "exit", code: 1, stopped: false }, { outcome: "failed", reason: "Error: no space left" }],
    [{ kind: "exit", code: null, stopped: true }, { outcome: "stopped", reason: "Error: no space left" }],
    [{ kind: "error", message: "brew is broken" }, { outcome: "failed", reason: "brew is broken" }],
  ];
  for (const [event, end] of cases) {
    const fake = install();
    const seen = watch();
    runOllamaInstall(fake, seen.handlers);
    await vi.waitFor(() => expect(fake.installOllama).toHaveBeenCalled());
    fake.emit({ kind: "output", text: "Error: no space left\n" });
    fake.emit(event);
    expect(seen.ends).toEqual([end]);
  }
});

test("a failed install with no output says brew install ollama failed", async () => {
  const fake = install();
  const seen = watch();
  runOllamaInstall(fake, seen.handlers);
  await vi.waitFor(() => expect(fake.installOllama).toHaveBeenCalled());
  fake.emit({ kind: "exit", code: 1, stopped: false });
  expect(seen.ends).toEqual([{ outcome: "failed", reason: "brew install ollama failed" }]);
});

test("no Homebrew ends the install as no_brew, and a refused call as failed", async () => {
  const none = install("no_brew");
  const first = watch();
  runOllamaInstall(none, first.handlers);
  await vi.waitFor(() => expect(first.ends).toEqual([{ outcome: "no_brew", reason: "" }]));

  const broken = install(new Error("boom"));
  const second = watch();
  runOllamaInstall(broken, second.handlers);
  await vi.waitFor(() => expect(second.ends).toHaveLength(1));
  expect(second.ends[0]).toEqual({ outcome: "failed", reason: "boom" });
});

test("start Ollama lists the models again; an Ollama that does not come up rejects", async () => {
  const refreshModels = vi.fn(async () => WORKING_LISTING);
  const startOllama = vi.fn(async () => true);
  expect(await startOllamaAndList({ startOllama, refreshModels })).toBe(WORKING_LISTING);
  expect(refreshModels).toHaveBeenCalledTimes(1);

  const down = vi.fn(async () => false);
  refreshModels.mockClear();
  await expect(startOllamaAndList({ startOllama: down, refreshModels })).rejects.toThrow("Ollama didn't start");
  expect(refreshModels).not.toHaveBeenCalled();
});

test("checking again lists the models and reads the rows, and fails if either does", async () => {
  const refreshModels = vi.fn(async () => WORKING_LISTING);
  const refetch = vi.fn(async () => undefined);
  await checkSetupAgain({ refreshModels }, refetch);
  expect(refreshModels).toHaveBeenCalledTimes(1);
  expect(refetch).toHaveBeenCalledTimes(1);
  await expect(checkSetupAgain({ refreshModels }, async () => Promise.reject(new Error("gone")))).rejects.toThrow("gone");
});

test("the log keeps the newest of a redrawn line and drops the trailing blank", () => {
  expect(installLog("a\nb 10%\rb 90%\n\n")).toBe("a\nb 90%");
  expect(installLog("")).toBe("");
});
