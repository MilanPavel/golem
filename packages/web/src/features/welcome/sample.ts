import type { ListedModel, ModelListResult } from "../../store/models.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";
import type { KeyProvider } from "../setup/setup-form.tsx";
import type { ToolsOfferViewProps } from "../setup/tools-offer.tsx";
import { toolsAdding, toolsGithubTicked, toolsOffered } from "../setup/tools-sample.ts";
import type { SetupActionsState } from "../setup/use-setup-actions.ts";
import type { ToolsState } from "@golem/view";
import type { EngineStepProps } from "./engine-step.tsx";
import type { ModelStepProps } from "./model-step.tsx";
import type { ReadyStepProps } from "./ready-step.tsx";
import type { ToolsStepProps } from "./tools-step.tsx";
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

const local = (name: string, label: string, sizeGb: number, extra: Partial<ListedModel> = {}): ListedModel => ({
  ref: `ollama/${name}`,
  label,
  provider: "ollama",
  source: "catalog",
  status: "not_installed",
  size_gb: sizeGb,
  fit: "fits",
  ...extra,
});

/** A fresh 16 GB Mac: four models fit and one is recommended, so three lead; the fourth and three too big sit behind Show all. */
export const MODEL_LISTING: ModelListResult = {
  default: null,
  ram_gb: 16,
  models: [
    local("gemma4:12b", "Gemma 4 12B", 8.1, { categories: ["general", "vision"] }),
    local("qwen3.5:4b", "Qwen3.5 4B", 2.6, { recommended: true, categories: ["general", "fast"] }),
    local("gemma3:12b", "Gemma 3 12B", 6.6),
    local("qwen3:8b", "Qwen3 8B", 5.2),
    local("qwen3-coder:30b", "Qwen3 Coder 30B", 18, { fit: "too_big", categories: ["coding"] }),
    local("qwen3:32b", "Qwen3 32B", 20, { fit: "too_big" }),
    local("llama3.3:70b", "Llama 3.3 70B", 43, { fit: "too_big" }),
  ],
  providers: [{ provider: "ollama", status: "ready" }],
  setup: { ollama_installed: true, ollama_running: true },
};

/** `qwen3.5:4b` a third downloaded. */
export const MODEL_PULLS: PullsSnapshot = {
  active: new Map([
    [
      "ollama/qwen3.5:4b",
      { track: { completed: 884_000_000, total: 2_600_000_000, samples: [] }, status: "pulling", progress: 0.34 },
    ],
  ]),
  failed: new Map(),
};

const NO_PULLS: PullsSnapshot = { active: new Map(), failed: new Map() };

export function modelProps(change: Partial<ModelStepProps> = {}): ModelStepProps {
  return {
    listing: MODEL_LISTING,
    pulls: NO_PULLS,
    speed: 25_000_000,
    onDownload: async () => undefined,
    onUse: async () => undefined,
    onStop: async () => undefined,
    onContinue: noop,
    ...change,
  };
}

/** The Tools step with its panel in `state`, every handler doing nothing. */
export function toolsProps(state: ToolsState): ToolsStepProps {
  const offer: ToolsOfferViewProps = {
    state,
    draft: "",
    logs: {},
    onDraft: noop,
    onTick: noop,
    onStart: noop,
    onSkip: noop,
    onContinue: noop,
    onRetry: noop,
    onSkipRow: noop,
    onLog: noop,
  };
  return { offer, failed: false, onContinue: noop };
}

export function readyProps(change: Partial<ReadyStepProps> = {}): ReadyStepProps {
  return {
    engine: "Ollama on this Mac",
    model: { kind: "ready", text: "qwen3.5:4b · default" },
    tools: "skipped",
    toolsSkipped: true,
    keepNote: null,
    app: { offer: null, host: "127.0.0.1:7480", onInstall: noop },
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
    tools: { offer: null, failed: false, onContinue: noop },
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
  { label: "Model, pick one", props: welcomeProps("model") },
  {
    label: "Model, downloading",
    props: welcomeProps("model", {
      working: true,
      model: modelProps({ pulls: MODEL_PULLS }),
    }),
  },
  { label: "Model, default gone", props: welcomeProps("model", { states: ["done", "current", "skipped", "todo"], banner: DEFAULT_GONE }) },
  { label: "Tools, the offer", props: welcomeProps("tools", { states: stepStates("tools", true), tools: toolsProps(toolsOffered()) }) },
  { label: "Tools, GitHub ticked", props: welcomeProps("tools", { states: stepStates("tools", true), tools: toolsProps(toolsGithubTicked()) }) },
  { label: "Tools, adding", props: welcomeProps("tools", { states: stepStates("tools", true), working: true, tools: toolsProps(toolsAdding()) }) },
  { label: "Ready", props: welcomeProps("ready") },
  {
    label: "Ready, model downloading",
    props: welcomeProps("ready", {
      working: true,
      ready: readyProps({ model: { kind: "downloading", id: "qwen3.5:4b", share: 0.72, text: "72% · 40 s" }, keepNote: { command: "golem install" } }),
    }),
  },
  { label: "Ready, page not kept", props: welcomeProps("ready", { ready: readyProps({ keepNote: { command: "golem web install", page: "only" } }) }) },
  { label: "Ready, install in Chrome", props: welcomeProps("ready", { ready: readyProps({ app: { offer: "prompt", host: "127.0.0.1:7480", onInstall: noop } }) }) },
  { label: "Ready, install in Safari", props: welcomeProps("ready", { ready: readyProps({ app: { offer: "safari", host: "127.0.0.1:7480", onInstall: noop } }) }) },
  { label: "Ready, install from the Chrome menu", props: welcomeProps("ready", { ready: readyProps({ app: { offer: "chromium", host: "127.0.0.1:7480", onInstall: noop } }) }) },
  { label: "Ready, install in another browser", props: welcomeProps("ready", { ready: readyProps({ app: { offer: "other", host: "127.0.0.1:7480", onInstall: noop } }) }) },
  { label: "Ready, app installed", props: welcomeProps("ready", { ready: readyProps({ app: { offer: "installed", host: "127.0.0.1:7480", onInstall: noop } }) }) },
  { label: "Ready, from a send", props: welcomeProps("ready", { ready: readyProps({ fromSend: true }) }) },
];
