import type { ListedModel, ModelListResult } from "../../store/models.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";

function model(ref: string, extra: Partial<ListedModel> = {}): ListedModel {
  return {
    ref,
    label: ref.slice(ref.indexOf("/") + 1),
    provider: ref.slice(0, ref.indexOf("/")),
    source: "remote",
    status: "ready",
    ...extra,
  };
}

const FREE = { input: 0, output: 0 };

/** Every group and every status: profiles, installed, to download, too big, remote, a key missing, a server down. */
export const SAMPLE_LISTING: ModelListResult = {
  default: "ollama/gemma4:e4b",
  ram_gb: 16,
  disk_free_gb: 120,
  models: [
    model("ollama/qwen3:8b", { label: "Qwen3 8B", source: "installed", profiles: ["local"], price: FREE, size_gb: 5.2, fit: "fits", ctx: 40960 }),
    model("anthropic/claude-sonnet-4", { label: "Claude Sonnet 4", source: "profile", status: "needs_key", profiles: ["sonnet"], ctx: 200000, price: { input: 3, output: 15 } }),
    model("ollama/gemma4:e4b", { label: "Gemma 4 E4B", source: "installed", price: FREE, size_gb: 9.6, fit: "fits", ctx: 131072 }),
    model("ollama/qwen3:14b", { label: "Qwen3 14B", source: "catalog", status: "not_installed", price: FREE, size_gb: 9.3, fit: "fits", ctx: 40960 }),
    model("ollama/qwen3:32b", { label: "Qwen3 32B", source: "catalog", status: "not_installed", price: FREE, size_gb: 20, fit: "too_big", ctx: 40960 }),
    model("ollama/gemma3:12b", { label: "Gemma 3 12B", source: "catalog", status: "not_installed", price: FREE, size_gb: 6.6, fit: "fits", ctx: 131072 }),
    model("openrouter/qwen/qwen3-235b", { label: "Qwen3 235B", price: { input: 0.2, output: 0.6 }, ctx: 131072 }),
    model("groq/llama-3.3-70b", { label: "Llama 3.3 70B", status: "needs_key", price: { input: 0.59, output: 0.79 }, ctx: 131072 }),
    model("lmstudio/qwen2.5-7b", { label: "Qwen2.5 7B", status: "server_down", price: FREE }),
  ],
  providers: [
    { provider: "groq", status: "needs_key" },
    { provider: "lmstudio", status: "server_down" },
    { provider: "ollama", status: "ready" },
    { provider: "openrouter", status: "ready" },
  ],
  setup: { ollama_installed: true, ollama_running: true, keys: ["openrouter"], default_status: "ready" },
};

/** Ollama is installed but not answering. */
export const OLLAMA_DOWN_LISTING: ModelListResult = {
  default: null,
  ram_gb: 16,
  models: [
    model("ollama/qwen3:8b", { label: "Qwen3 8B", source: "installed", status: "server_down", price: FREE, size_gb: 5.2, fit: "fits" }),
    model("ollama/qwen3:14b", { label: "Qwen3 14B", source: "catalog", status: "server_down", price: FREE, size_gb: 9.3, fit: "fits" }),
  ],
  providers: [{ provider: "ollama", status: "server_down" }],
  setup: { ollama_installed: true, ollama_running: false },
};

/** There is no Ollama on this Mac. */
export const NO_OLLAMA_LISTING: ModelListResult = {
  default: "openrouter/qwen/qwen3-235b",
  ram_gb: null,
  models: [
    model("ollama/qwen3:8b", { label: "Qwen3 8B", source: "catalog", status: "not_installed", price: FREE, size_gb: 5.2, fit: "fits" }),
    model("openrouter/qwen/qwen3-235b", { label: "Qwen3 235B", price: { input: 0.2, output: 0.6 } }),
  ],
  providers: [
    { provider: "ollama", status: "not_installed" },
    { provider: "openrouter", status: "ready" },
  ],
  setup: { ollama_installed: false, ollama_running: false, keys: ["openrouter"] },
};

/** A download of `ollama/gemma3:12b` a third done, and a failed one. */
export const SAMPLE_PULLS: PullsSnapshot = {
  active: new Map([
    [
      "ollama/gemma3:12b",
      {
        status: "pulling",
        progress: 2.1 / 6.6,
        track: {
          completed: 2_100_000_000,
          total: 6_600_000_000,
          samples: [
            { at: 0, bytes: 2_076_000_000 },
            { at: 2_000, bytes: 2_100_000_000 },
          ],
        },
      },
    ],
  ]),
  failed: new Map([["ollama/qwen3:14b", "no space left on device"]]),
};
