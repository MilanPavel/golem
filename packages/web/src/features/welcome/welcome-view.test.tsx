import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test, vi } from "vitest";
import { DEFAULT_GONE, engineProps, INSTALL_OUTPUT, modelProps, readyProps, WELCOME_CASES, welcomeProps } from "./sample.ts";
import { nextStep, stepStates } from "./welcome-steps.ts";
import { WelcomeView } from "./welcome-view.tsx";

const stepper = () => screen.getByRole("list", { name: "Setup steps" });

/** Each step of the stepper as the words a person reads: its name, then its state. */
const stepWords = () =>
  within(stepper())
    .getAllByRole("listitem")
    .map((item) =>
      [...item.querySelectorAll("button, span")]
        .filter((node) => node.children.length === 0 && node.getAttribute("aria-hidden") !== "true")
        .map((node) => node.textContent)
        .join(" "),
    );

test("the first step welcomes, and the stepper says each step in words as well as marks", () => {
  render(<WelcomeView {...welcomeProps("engine")} />);
  expect(screen.getByRole("heading", { level: 1, name: "Welcome to golem" })).toBeTruthy();
  expect(screen.getByText("Four short steps, then you can chat. About two minutes, plus a download.")).toBeTruthy();
  expect(stepWords()).toEqual(["Engine current step", "Model to do", "Tools skipped", "Ready to do"]);
  expect(within(stepper()).getByText("Engine").closest("[aria-current]")?.getAttribute("aria-current")).toBe("step");
  expect(screen.getByRole("heading", { level: 2, name: "How should golem think?" })).toBeTruthy();
});

test("only the first step has the welcome", () => {
  render(<WelcomeView {...welcomeProps("model")} />);
  expect(screen.queryByText("Welcome to golem")).toBeNull();
  expect(screen.queryByText(/Four short steps/)).toBeNull();
});

test("a done step is a button that goes back to it, and the others are not buttons", async () => {
  const user = userEvent.setup();
  const onStep = vi.fn();
  render(<WelcomeView {...welcomeProps("ready", { onStep })} />);
  // Model and Engine are done; Tools is skipped, Ready is the step in view.
  const buttons = within(stepper()).getAllByRole("button");
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Engine, done. Go back to it", "Model, done. Go back to it"]);
  await user.click(buttons[1]!);
  expect(onStep).toHaveBeenCalledWith("model");
  expect(within(stepper()).getAllByText("skipped")).toHaveLength(1);
});

test("Later calls back at every step but Ready, where it is hidden", async () => {
  const user = userEvent.setup();
  const onLater = vi.fn();
  const view = render(<WelcomeView {...welcomeProps("engine", { onLater })} />);
  await user.click(screen.getByRole("button", { name: "Later" }));
  expect(onLater).toHaveBeenCalledTimes(1);
  for (const step of ["model", "tools"] as const) {
    view.rerender(<WelcomeView {...welcomeProps(step, { onLater })} />);
    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy();
  }
  view.rerender(<WelcomeView {...welcomeProps("ready", { onLater })} />);
  expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
});

test("the step's choices of Engine are two, and a click chooses", async () => {
  const user = userEvent.setup();
  const onChoice = vi.fn();
  render(<WelcomeView {...welcomeProps("engine", { engine: engineProps({ onChoice }) })} />);
  const group = screen.getByRole("group", { name: "How golem thinks" });
  const local = within(group).getByRole("button", { name: /On this Mac/ });
  const key = within(group).getByRole("button", { name: /With an API key/ });
  expect(local.getAttribute("aria-pressed")).toBe("true");
  expect(key.getAttribute("aria-pressed")).toBe("false");
  await user.click(key);
  expect(onChoice).toHaveBeenCalledWith("key");
});

test("Ollama missing: Install Ollama is the fix, and Continue waits", async () => {
  const user = userEvent.setup();
  const onInstall = vi.fn();
  render(<WelcomeView {...welcomeProps("engine", { engine: engineProps({ onInstall }) })} />);
  expect(screen.getByText("Not installed. golem uses it to run models on this Mac.")).toBeTruthy();
  expect(screen.getByText("Installs with Homebrew · about 200 MB")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Install Ollama" }));
  expect(onInstall).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
});

test("an install shows its streamed output in an open Output disclosure, and Stop", async () => {
  const user = userEvent.setup();
  const onCancelInstall = vi.fn();
  const props = welcomeProps("engine", {
    engine: engineProps({ ollama: "installing", onCancelInstall, actions: { running: "install", output: INSTALL_OUTPUT, noBrew: false, error: null, from: null } }),
  });
  const { container } = render(<WelcomeView {...props} />);
  expect(screen.getByText("Installing with Homebrew…")).toBeTruthy();
  const details = container.querySelector("details");
  expect(details?.open).toBe(true);
  expect(within(details as HTMLElement).getByText("Output")).toBeTruthy();
  expect(details?.textContent).toContain("==> Fetching ollama");
  await user.click(screen.getByRole("button", { name: "Stop" }));
  expect(onCancelInstall).toHaveBeenCalledTimes(1);
});

test("with no Homebrew the card links ollama.com/download in a new tab and offers Check again", async () => {
  const user = userEvent.setup();
  const onCheck = vi.fn();
  const props = welcomeProps("engine", {
    engine: engineProps({ ollama: "no_brew", onCheck, actions: { running: null, output: "", noBrew: true, error: null, from: null } }),
  });
  render(<WelcomeView {...props} />);
  expect(screen.getByText("Not installed, and Homebrew isn't here to install it.")).toBeTruthy();
  const link = screen.getByRole("link", { name: /Download Ollama/ });
  expect(link.getAttribute("href")).toBe("https://ollama.com/download");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  await user.click(screen.getByRole("button", { name: "Check again" }));
  expect(onCheck).toHaveBeenCalledWith("ollama");
});

test("a stopped Ollama has a Start button", async () => {
  const user = userEvent.setup();
  const onStart = vi.fn();
  render(<WelcomeView {...welcomeProps("engine", { engine: engineProps({ ollama: "stopped", onStart }) })} />);
  await user.click(screen.getByRole("button", { name: "Start Ollama" }));
  expect(onStart).toHaveBeenCalledTimes(1);
});

test("Ollama running says so, with no models yet, and Continue is enabled and has focus", async () => {
  const user = userEvent.setup();
  const onContinue = vi.fn();
  render(<WelcomeView {...welcomeProps("engine", { engine: engineProps({ ollama: "running", ready: true, onContinue }) })} />);
  expect(screen.getByText("Running · no models yet")).toBeTruthy();
  const next = screen.getByRole("button", { name: "Continue" });
  expect((next as HTMLButtonElement).disabled).toBe(false);
  expect(document.activeElement).toBe(next);
  await user.keyboard("{Enter}");
  expect(onContinue).toHaveBeenCalledTimes(1);
});

test("Continue takes focus when the engine becomes ready, not before", () => {
  const view = render(<WelcomeView {...welcomeProps("engine", { engine: engineProps({ ollama: "starting" }) })} />);
  expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Continue" }));
  view.rerender(<WelcomeView {...welcomeProps("engine", { engine: engineProps({ ollama: "running", ready: true }) })} />);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Continue" }));
});

test("with an API key: a provider select, the command with Copy, and Check again", async () => {
  const user = userEvent.setup();
  const onProvider = vi.fn();
  const onCheck = vi.fn();
  render(<WelcomeView {...welcomeProps("engine", { engine: engineProps({ choice: "key", onProvider, onCheck }) })} />);
  expect(screen.getByText("golem auth set anthropic")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  // The page has no field for a key.
  expect(screen.queryByRole("textbox")).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "openai");
  expect(onProvider).toHaveBeenCalledWith("openai");
  await user.click(screen.getByRole("button", { name: "Check again" }));
  expect(onCheck).toHaveBeenCalledWith("key");
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
});

test("a saved key is done: no command, and Continue is enabled", () => {
  const props = WELCOME_CASES.find((each) => each.label === "Engine, key saved")?.props;
  render(<WelcomeView {...(props ?? welcomeProps("engine"))} />);
  expect(screen.getByText("Key saved in your macOS Keychain.")).toBeTruthy();
  expect(screen.queryByText(/golem auth set/)).toBeNull();
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
});

test("Model, a placeholder: choose opens the list, and Continue waits for a model or a download", async () => {
  const user = userEvent.setup();
  const onChoose = vi.fn();
  const view = render(<WelcomeView {...welcomeProps("model", { model: modelProps({ onChoose }) })} />);
  expect(screen.getByRole("heading", { level: 2, name: "Pick a model" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Choose a model…" }));
  expect(onChoose).toHaveBeenCalledTimes(1);
  view.rerender(<WelcomeView {...welcomeProps("model", { model: modelProps({ download: { id: "qwen3.5:4b", share: 0.34, text: "34% · 2 min" } }) })} />);
  expect(screen.getByRole("progressbar", { name: "Downloading qwen3.5:4b" }).getAttribute("aria-valuenow")).toBe("34");
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  view.rerender(<WelcomeView {...welcomeProps("model", { model: modelProps({ current: "qwen3.5:4b" }) })} />);
  expect(screen.getByText("qwen3.5:4b · default")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
});

test("?step=model with a default that is gone: Engine done, Tools skipped, and the banner names the model", () => {
  const props = WELCOME_CASES.find((each) => each.label === "Model, default gone")?.props ?? welcomeProps("model");
  render(<WelcomeView {...props} />);
  expect(screen.getByRole("status").textContent).toContain(DEFAULT_GONE);
  expect(screen.getByRole("status").textContent).toContain("ollama/llama3.2:3b");
  expect(stepWords()).toEqual(["Engine done", "Model current step", "Tools skipped", "Ready to do"]);
});

test("Ready: a line for each step, what was set up, and Start chatting", async () => {
  const user = userEvent.setup();
  const onStart = vi.fn();
  render(<WelcomeView {...welcomeProps("ready", { ready: readyProps({ onStart }) })} />);
  expect(screen.getByRole("heading", { level: 2, name: "golem is ready." })).toBeTruthy();
  const lines = within(screen.getByRole("list", { name: "What was set up" })).getAllByRole("listitem");
  expect(lines).toHaveLength(3);
  expect(lines[0]?.textContent).toContain("done: Engine");
  expect(lines[0]?.textContent).toContain("Ollama on this Mac");
  expect(lines[1]?.textContent).toContain("done: Model");
  expect(lines[1]?.textContent).toContain("qwen3.5:4b · default");
  // A step that was left out says so in words, not only with a dash.
  expect(lines[2]?.textContent).toContain("skipped: Tools");
  expect(lines[2]?.textContent).toContain("skipped");
  expect(screen.queryByText(/stop when you close the terminal window/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  expect(onStart).toHaveBeenCalledTimes(1);
});

test("Ready while the default model downloads: Almost ready, the bar in the Model line, Start chatting disabled", () => {
  const props = WELCOME_CASES.find((each) => each.label === "Ready, model downloading")?.props ?? welcomeProps("ready");
  render(<WelcomeView {...props} />);
  expect(screen.getByRole("heading", { level: 2, name: "Almost ready." })).toBeTruthy();
  const model = within(screen.getByRole("list", { name: "What was set up" })).getAllByRole("listitem")[1] as HTMLElement;
  expect(within(model).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("72");
  expect((screen.getByRole("button", { name: "Start chatting" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
});

test("the same page turns into golem is ready when the download ends", () => {
  const downloading = WELCOME_CASES.find((each) => each.label === "Ready, model downloading")?.props ?? welcomeProps("ready");
  const view = render(<WelcomeView {...downloading} />);
  view.rerender(<WelcomeView {...welcomeProps("ready")} />);
  expect(screen.getByRole("heading", { level: 2, name: "golem is ready." })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Start chatting" }) as HTMLButtonElement).disabled).toBe(false);
});

test("Ready when the service is not kept: the note with the command and Copy, never blocking", () => {
  render(<WelcomeView {...welcomeProps("ready", { ready: readyProps({ keepNote: { command: "golem daemon install" } }) })} />);
  expect(screen.getByText("golem and this page stop when you close the terminal window. To keep them running, even after a restart:")).toBeTruthy();
  expect(screen.getByText("golem daemon install")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Start chatting" }) as HTMLButtonElement).disabled).toBe(false);
});

test("Ready from a send says where it goes, and that nothing was sent", async () => {
  const user = userEvent.setup();
  const onStart = vi.fn();
  render(<WelcomeView {...welcomeProps("ready", { ready: readyProps({ fromSend: true, onStart }) })} />);
  expect(screen.getByText("Your message is waiting where you left it. Nothing has been sent.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Start chatting" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Back to your message" }));
  expect(onStart).toHaveBeenCalledTimes(1);
});

test("Tools, a placeholder, shows and goes on", async () => {
  const user = userEvent.setup();
  const onContinue = vi.fn();
  render(<WelcomeView {...welcomeProps("tools", { tools: { onContinue } })} />);
  expect(screen.getByRole("heading", { level: 2, name: "Give golem some tools?" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

test("a step change can take focus to the page root", () => {
  const ref = { current: null as HTMLDivElement | null };
  render(<WelcomeView {...welcomeProps("model")} rootRef={ref} />);
  act(() => {
    ref.current?.focus();
  });
  expect(document.activeElement).toBe(ref.current);
});

test("the steps follow the terminal's table: Engine, Model, then Ready, with Tools between once it is offered", () => {
  expect(nextStep("engine", false)).toBe("model");
  expect(nextStep("model", false)).toBe("ready");
  expect(nextStep("model", true)).toBe("tools");
  expect(nextStep("tools", true)).toBe("ready");
  expect(nextStep("ready", false)).toBeNull();
  expect(stepStates("engine", false)).toEqual(["current", "todo", "skipped", "todo"]);
  expect(stepStates("tools", false)).toEqual(["done", "done", "current", "todo"]);
  expect(stepStates("model", true)).toEqual(["done", "current", "todo", "todo"]);
});

for (const { label, props } of WELCOME_CASES) {
  test(`no accessibility violations: ${label}`, async () => {
    const { container } = render(<WelcomeView {...props} />);
    const results = await axe.run(container, {
      resultTypes: ["violations"],
      // jsdom does not compute colors; tokens.test.ts checks the pairs. A page has its own landmark in the shell.
      rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
}
