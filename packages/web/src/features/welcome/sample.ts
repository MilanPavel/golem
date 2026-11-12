import type { KeyProvider } from "../setup/setup-form.tsx";
import type { SetupActionsState } from "../setup/use-setup-actions.ts";
import type { EngineStepProps } from "./engine-step.tsx";
import type { ModelStepProps } from "./model-step.tsx";
import type { ReadyStepProps } from "./ready-step.tsx";
import { stepStates, type WelcomeStep } from "./welcome-steps.ts";
import type { WelcomeViewProps } from "./welcome-view.tsx";

const noop = (): void => undefined;

const NO_ACTION: SetupActionsState = { running: null, output: "", noBrew: false, error: null, from: null };

const key = (id: string, name: string, blurb: string, saved: boolean): KeyProvider => ({ id, name, blurb, saved });
const NO_KEYS = [key("anthropic", "Anthropic", "Claude", false), key("openai", "OpenAI", "GPT", false), key("google", "Google", "Gemini", false)];
const ANTHROPIC_SAVED = [key("anthropic", "Anthropic", "Claude", true), key("openai", "OpenAI", "GPT", false), key("google", "Google", "Gemini", false)];

/** The Engine step with Ollama missing, as a fresh install has it. Each case changes what it needs. */
export function engineProps(change: Partial<EngineStepProps> = {}): EngineStepProps {
  return {
    choice: "local",
    onChoice: noop,
    ollama: "missing",
    downloaded: 0,
    actions: NO_ACTION,
    onInstall: noop,
    onCancelInstall: noop,
    onStart: noop,
    onCheck: noop,
    providers: NO_KEYS,
    provider: "anthropic",
    onProvider: noop,
    ready: false,
    onContinue: noop,
    ...change,
  };
}

export function modelProps(change: Partial<ModelStepProps> = {}): ModelStepProps {
  return { current: null, download: null, failed: null, onChoose: noop, onContinue: noop, ...change };
}

export function readyProps(change: Partial<ReadyStepProps> = {}): ReadyStepProps {
  return {
    engine: "Ollama on this Mac",
    model: { kind: "ready", text: "qwen3.5:4b · default" },
    tools: "skipped",
    toolsSkipped: true,
    keepNote: null,
    fromSend: false,
    onStart: noop,
    ...change,
  };
}

/** The page at `step`, with every handler doing nothing. */
export function welcomeProps(step: WelcomeStep, change: Partial<WelcomeViewProps> = {}): WelcomeViewProps {
  return {
    step,
    states: stepStates(step, false),
    working: false,
    banner: null,
    onStep: noop,
    onLater: noop,
    engine: engineProps(),
    model: modelProps(),
    tools: { onContinue: noop },
    ready: readyProps(),
    ...change,
  };
}

export const INSTALL_OUTPUT =
  "==> Fetching ollama\n==> Downloading https://ghcr.io/v2/homebrew/core/ollama/blobs/sha256:abc\n######################################                      61.4%";

export const DEFAULT_GONE =
  "Your default model ollama/llama3.2:3b is no longer installed. Pick another to keep chatting.";

export type WelcomeCase = { label: string; props: WelcomeViewProps };

/** The page in each step and state it draws, for the gallery and its test. The labels follow the mock's scenes. */
export const WELCOME_CASES: WelcomeCase[] = [
  { label: "Engine, Ollama missing", props: welcomeProps("engine") },
  {
    label: "Engine, installing Ollama",
    props: welcomeProps("engine", {
      working: true,
      engine: engineProps({ ollama: "installing", actions: { ...NO_ACTION, running: "install", output: INSTALL_OUTPUT } }),
    }),
  },
  {
    label: "Engine, no Homebrew",
    props: welcomeProps("engine", { engine: engineProps({ ollama: "no_brew", actions: { ...NO_ACTION, noBrew: true } }) }),
  },
  { label: "Engine, Ollama ready", props: welcomeProps("engine", { engine: engineProps({ ollama: "running", ready: true }) }) },
  { label: "Engine, with an API key", props: welcomeProps("engine", { engine: engineProps({ choice: "key" }) }) },
  {
    label: "Engine, key saved",
    props: welcomeProps("engine", { engine: engineProps({ choice: "key", providers: ANTHROPIC_SAVED, ready: true }) }),
  },
  { label: "Model, none yet", props: welcomeProps("model") },
  {
    label: "Model, downloading",
    props: welcomeProps("model", {
      working: true,
      model: modelProps({ download: { id: "qwen3.5:4b", share: 0.34, text: "34% · 2 min" } }),
    }),
  },
  { label: "Model, default gone", props: welcomeProps("model", { states: ["done", "current", "skipped", "todo"], banner: DEFAULT_GONE }) },
  { label: "Tools", props: welcomeProps("tools") },
  { label: "Ready", props: welcomeProps("ready") },
  {
    label: "Ready, model downloading",
    props: welcomeProps("ready", {
      working: true,
      ready: readyProps({ model: { kind: "downloading", id: "qwen3.5:4b", share: 0.72, text: "72% · 40 s" }, keepNote: { command: "golem install" } }),
    }),
  },
  { label: "Ready, page not kept", props: welcomeProps("ready", { ready: readyProps({ keepNote: { command: "golem web install", page: "only" } }) }) },
  { label: "Ready, from a send", props: welcomeProps("ready", { ready: readyProps({ fromSend: true }) }) },
];
