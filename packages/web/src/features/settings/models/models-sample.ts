import type { AuthKeyStatus } from "../../../store/keys.ts";
import type { HfFilesResult, HfSearchResult, ListedModel, ModelListResult } from "../../../store/models.ts";
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
  local("qwen3.8:32b", "Qwen 3.8 · 32B", 20, { source: "catalog", status: "not_installed", recommended: true, fit: "fits", categories: ["general", "reasoning"] }),
  local("llama4-scout", "Llama 4 Scout", 35, { source: "catalog", status: "not_installed", fit: "tight", categories: ["general", "vision"] }),
  local("qwen3.8:72b", "Qwen 3.8 · 72B", 47, { source: "catalog", status: "not_installed", fit: "too_big", categories: ["reasoning"] }),
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

/** The catalog as the daemon lists it for a 64 GB Mac: with categories, and a pick for each. */
const CATALOG: ListedModel[] = [
  local("qwen3.8:27b", "Qwen 3.8 · 27B", 16.8, { categories: ["general", "reasoning"] }),
  local("llama3.2:3b", "Llama 3.2 · 3B", 2, { categories: ["general", "fast"] }),
  local("gemma4:12b", "Gemma 4 · 12B", 8.1, { source: "catalog", status: "not_installed", fit: "fits", categories: ["general", "vision"], recommended: true, recommended_for: ["general", "vision"] }),
  local("qwen2.5-coder:7b", "Qwen2.5 Coder · 7B", 4.7, { source: "catalog", status: "not_installed", fit: "fits", categories: ["coding"], recommended_for: ["coding"] }),
  local("deepseek-r1:8b", "DeepSeek R1 · 8B", 5.2, { source: "catalog", status: "not_installed", fit: "fits", categories: ["reasoning"] }),
  local("phi4-mini:3.8b", "Phi-4-mini", 2.5, { source: "catalog", status: "not_installed", fit: "fits", categories: ["fast"] }),
  local("llama4-scout", "Llama 4 Scout", 35, { source: "catalog", status: "not_installed", fit: "tight", categories: ["general", "vision"] }),
  local("gpt-oss:120b", "gpt-oss · 120B", 65, { source: "catalog", status: "not_installed", fit: "too_big", categories: ["reasoning"] }),
];

const GET_BASE = { label: "", keys: TWO_KEYS, ollama: OLLAMA_VALUES } as const;

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
  hf: { search: () => Promise.resolve({ repos: [] }), files: (repo) => Promise.resolve({ repo, sizes: [] }) },
  saveOllama: () => Promise.resolve({ ok: true, errors: [], values: OLLAMA_VALUES }),
};

export const HF_RESULTS: HfSearchResult = {
  repos: [
    { id: "unsloth/Qwen3.8-27B-Instruct-GGUF", downloads: 412_000, likes: 380, updated: "2026-11-19T10:00:00Z", gated: false },
    { id: "bartowski/Qwen3.8-27B-Instruct-GGUF", downloads: 198_000, likes: 120, updated: "2026-11-17T10:00:00Z", gated: false },
    { id: "meta-llama/Llama-4-Scout-GGUF", downloads: 61_000, likes: 90, updated: null, gated: true },
  ],
};

export const HF_FILES: HfFilesResult = {
  repo: "unsloth/Qwen3.8-27B-Instruct-GGUF",
  sizes: [
    { quant: "Q3_K_M", size_gb: 13.1, files: 1, fit: "fits", recommended: false },
    { quant: "Q4_K_M", size_gb: 16.8, files: 1, fit: "fits", recommended: true },
    { quant: "Q6_K", size_gb: 22.4, files: 1, fit: "fits", recommended: false },
    { quant: "Q8_0", size_gb: 48.9, files: 2, fit: "tight", recommended: false },
    { quant: "F16", size_gb: 94.2, files: 4, fit: "too_big", recommended: false },
  ],
};

export type ModelsCase = Omit<ModelsViewProps, "actions" | "setup" | "pulls"> & { label: string; pulls?: PullsSnapshot };

/** Settings › Models in the states the page draws, for the gallery. */
export const MODELS_CASES: ModelsCase[] = [
  { label: "All starred models", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES },
  { label: "Ollama running", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "ollama" } },
  { label: "Ollama stopped", listing: listing(MODELS, { ollama_running: false }), keys: TWO_KEYS, ollama: { ...OLLAMA_VALUES, running: false }, initial: { selected: "ollama" } },
  { label: "Ollama not installed", listing: listing([], { ollama_installed: false, ollama_running: false }), keys: NO_KEYS, ollama: null, initial: { selected: "ollama" } },
  { label: "Ollama downloading and removing", listing: listing([...MODELS, pulling("qwen3.8:32b")]), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "ollama", removing: "ollama/qwen3.8:27b" } },
  { label: "Ollama with a Hugging Face model", listing: listing([...MODELS, local("hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_M", "Gemma 4 · 12B, from Hugging Face", 7.3, { speed: { reply_tps: 52, samples: 5 } })]), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "ollama" } },
  { label: "Hosted with a key", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "anthropic" } },
  { label: "Key from the environment", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "openai" } },
  { label: "Not set up", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "google" } },
  { label: "First run", listing: listing(MODELS.filter((model) => model.provider === "ollama")), keys: NO_KEYS, ollama: OLLAMA_VALUES },
  { label: "oMLX", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "omlx" } },
];

/** The sheets, each over the page. They are tested apart from the gallery, since a sheet covers the page. */
export const SHEET_CASES: { label: string; props: ModelsCase }[] = [
  { label: "Ollama settings", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "ollama", sheet: "settings" } } },
  { label: "Ollama settings, started outside golem", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: { ...OLLAMA_VALUES, started_by_golem: false }, initial: { selected: "ollama", sheet: "settings" } } },
  { label: "Replace or remove a key", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "anthropic", sheet: "key" } } },
  { label: "Replace or remove a key from the environment", props: { label: "", listing: listing(MODELS), keys: TWO_KEYS, ollama: OLLAMA_VALUES, initial: { selected: "openai", sheet: "key" } } },
];

const DOWNLOADING: PullsSnapshot = {
  active: new Map([["ollama/gemma4:12b", { track: { completed: 2.6e9, total: 8.1e9, samples: [] }, status: "pulling", progress: null }]]),
  failed: new Map([["ollama/qwen2.5-coder:7b", "no space left on the disk"]]),
};

const HF_DOWNLOADING: PullsSnapshot = {
  active: new Map([[`ollama/hf.co/${HF_FILES.repo}:Q6_K`, { track: { completed: 9e9, total: 22.4e9, samples: [] }, status: "pulling", progress: null }]]),
  failed: new Map(),
};

const MANY_DOWNLOADS: PullsSnapshot = {
  active: new Map([
    ["ollama/gemma4:12b", { track: { completed: 2.6e9, total: 8.1e9, samples: [] }, status: "pulling", progress: null }],
    ["ollama/hf.co/unsloth/Qwen3.8-27B-Instruct-GGUF:Q4_K_M", { track: { completed: 5.5e9, total: 16.2e9, samples: [] }, status: "pulling", progress: null }],
    ["ollama/qwen3.8:32b", { track: { completed: 0.4e9, total: 20e9, samples: [] }, status: "pulling", progress: null }],
  ]),
  failed: new Map([["ollama/qwen2.5-coder:7b", "no space left on the disk"]]),
};

/** Get models as a page, in the states it draws. It covers the Models page, so the gallery draws it apart. */
export const GET_CASES: { label: string; props: ModelsCase; pulls?: PullsSnapshot }[] = [
  { label: "Picked for this Mac", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get" } } },
  { label: "Picked for this Mac, downloading", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get" } }, pulls: DOWNLOADING },
  { label: "Picked for this Mac, many downloads", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get" } }, pulls: MANY_DOWNLOADS },
  { label: "Picked for this Mac, no match", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get", search: "zzz" } } },
  { label: "Picked for this Mac, coding", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get", filter: { category: "coding", hideTooBig: true } } } },
  { label: "By name", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get", tab: "name" } } },
  { label: "Hugging Face, popular", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get", tab: "hf", hf: { results: HF_RESULTS, files: HF_FILES } } } },
  { label: "Hugging Face, a search", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get", tab: "hf", search: "qwen3.8 27b", hf: { results: HF_RESULTS, files: HF_FILES } } } },
  { label: "Hugging Face, downloading", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get", tab: "hf", hf: { results: HF_RESULTS, files: HF_FILES } } }, pulls: HF_DOWNLOADING },
  { label: "Hugging Face, a repo that needs a token", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get", tab: "hf", hf: { results: HF_RESULTS, chosen: "meta-llama/Llama-4-Scout-GGUF" } } } },
  { label: "Hugging Face, no result", props: { ...GET_BASE, listing: listing(CATALOG), initial: { selected: "ollama", sheet: "get", tab: "hf", search: "zzzz", hf: { results: { repos: [] } } } } },
];
