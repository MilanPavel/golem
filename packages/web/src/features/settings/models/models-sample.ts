import type { AuthKeyStatus } from "../../../store/keys.ts";
import type { ListedModel, ModelListResult } from "../../../store/models.ts";
import type { OllamaSettingsValues } from "../../../store/notifications.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import type { SetupActions } from "../../setup/use-setup-actions.ts";
import type { ModelsActions, ModelsViewProps } from "./models-view.tsx";

const local = (name: string, label: string, size: number, fields: Partial<ListedModel> = {}): ListedModel => ({
  ref: `ollama/${name}`,
  label,
  provider: "ollama",
  source: "installed",
  status: "ready",
  tier: "local",
  size_gb: size,
  price: { input: 0, output: 0 },
  tools: true,
  ...fields,
});

const hosted = (provider: string, name: string, label: string, input: number, output: number, fields: Partial<ListedModel> = {}): ListedModel => ({
  ref: `${provider}/${name}`,
  label,
  provider,
  source: "remote",
  status: "ready",
  tier: input > 2 ? "frontier" : "budget",
  price: { input, output },
  tools: null,
  ...fields,
});

const MODELS: ListedModel[] = [
  local("qwen3.8:27b", "Qwen 3.8 · 27B", 16.8, { starred: true, speed: { reply_tps: 24, samples: 12 } }),
  local("qwen3.8:8b", "Qwen 3.8 · 8B", 5.2, { starred: true, speed: { reply_tps: 71, samples: 30 } }),
  local("gemma4:12b", "Gemma 4 · 12B", 8.1, { speed: { reply_tps: 46, samples: 8 } }),
  local("nomic-embed-text", "Embeddings, not for chat", 0.3, { tools: false }),
  local("qwen3.8:32b", "Qwen 3.8 · 32B", 20, { source: "catalog", status: "not_installed", recommended: true, fit: "fits" }),
  local("llama4-scout", "Llama 4 Scout", 35, { source: "catalog", status: "not_installed", fit: "tight" }),
  local("qwen3.8:72b", "Qwen 3.8 · 72B", 47, { source: "catalog", status: "not_installed", fit: "too_big" }),
  hosted("openai", "gpt-5", "GPT-5", 1.25, 10),
  hosted("openai", "gpt-5-mini", "GPT-5 mini", 0.25, 2, { starred: true, tools: true }),
  hosted("openai", "gpt-5-nano", "GPT-5 nano", 0.05, 0.4),
  hosted("anthropic", "claude-sonnet", "Claude Sonnet", 3, 15, { starred: true, tools: true }),
  hosted("anthropic", "claude-haiku", "Claude Haiku", 1, 5, { starred: true, tools: true }),
  hosted("anthropic", "claude-opus", "Claude Opus", 5, 25),
  hosted("deepseek", "deepseek-chat", "DeepSeek V4", 0.27, 1.1, { starred: true, tools: true }),
  hosted("google", "gemini-flash", "Gemini Flash", 0.3, 2.5),
];

const key = (provider: string, source: AuthKeyStatus["source"], env_var: string | null = null): AuthKeyStatus => ({ provider, takes_key: true, needs_key: true, source, env_var });

export const NO_KEYS: AuthKeyStatus[] = [];
export const TWO_KEYS: AuthKeyStatus[] = [key("anthropic", "keychain", "ANTHROPIC_API_KEY"), key("openai", "env", "OPENAI_API_KEY")];

const listing = (models: ListedModel[], setup: Partial<ModelListResult["setup"]> = {}): ModelListResult => ({
  default: "ollama/qwen3.8:27b",
  models,
  providers: [{ provider: "ollama", status: "ready" }],
  ram_gb: 64,
  setup: { ollama_installed: true, ollama_running: true, ...setup },
});

export const SAMPLE_LISTING = listing(MODELS);

export const OLLAMA_VALUES: OllamaSettingsValues = { start: true, idle_stop_minutes: 30, parallel: 1, started_by_golem: true, running: true };

export const NO_PULLS: PullsSnapshot = { active: new Map(), failed: new Map() };

const pulling = (name: string): ListedModel => local(name, name, 20, { source: "catalog", status: "pulling", progress: 0.34 });

export const IDLE_SETUP: SetupActions = {
  state: { running: null, output: "", noBrew: false, error: null, from: null },
  install: () => undefined,
  cancelInstall: () => undefined,
  start: () => undefined,
  checkAgain: () => undefined,
};

export const NO_ACTIONS: ModelsActions = {
  star: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  pull: () => Promise.resolve(),
  saveOllama: () => Promise.resolve({ ok: true, errors: [], values: OLLAMA_VALUES }),
};

export type ModelsCase = Omit<ModelsViewProps, "actions" | "setup" | "pulls"> & { label: string; pulls?: PullsSnapshot };

/** Settings › Models in the states the page draws, for the gallery. */
export const MODELS_CASES: ModelsCase[] = [
  { label: "All starred models", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES },
  { label: "Ollama running", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "ollama" } },
  { label: "Ollama stopped", listing: listing(MODELS, { ollama_running: false }), keys: TWO_KEYS, ollama: { ...OLLAMA_VALUES, running: false }, initial: { selected: "ollama" } },
  { label: "Ollama not installed", listing: listing([], { ollama_installed: false, ollama_running: false }), keys: NO_KEYS, ollama: null, initial: { selected: "ollama" } },
  { label: "Ollama downloading and removing", listing: listing([...MODELS, pulling("qwen3.8:32b")]), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "ollama", removing: "ollama/qwen3.8:27b" } },
  { label: "Hosted with a key", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "anthropic" } },
  { label: "Key from the environment", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "openai" } },
  { label: "Not set up", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "google" } },
  { label: "First run", listing: listing(MODELS.filter((model) => model.provider === "ollama")), keys: NO_KEYS, ollama: OLLAMA_VALUES },
  { label: "oMLX", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "omlx" } },
];

/** The sheets, each over the Ollama page. They are tested apart from the gallery, since a sheet covers the page. */
export const SHEET_CASES: { label: string; props: ModelsCase }[] = [
  { label: "Get models, for this Mac", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "ollama", sheet: "get" } } },
  { label: "Get models, by name", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "ollama", sheet: "get", tab: "name" } } },
  { label: "Ollama settings", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "ollama", sheet: "settings" } } },
  { label: "Ollama settings, started outside golem", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: { ...OLLAMA_VALUES, started_by_golem: false }, initial: { selected: "ollama", sheet: "settings" } } },
  { label: "Replace or remove a key", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "anthropic", sheet: "key" } } },
  { label: "Replace or remove a key from the environment", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "openai", sheet: "key" } } },
];
