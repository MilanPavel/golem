import { ASK_PAGE_KEY, guided, OVERVIEW, pageServiceRow, setupFormRows, single, type FormRow, type SetupWindow } from "@golem/view";
import type { ListedModel, ModelListResult, SetupRow } from "../../store/models.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";
import { newSetupUi, type PanelContext, type SetupUi } from "./setup-ui.ts";
import type { KeyProvider } from "./setup-form.tsx";
import type { SetupActionsState } from "./use-setup-actions.ts";

const FREE = { input: 0, output: 0 };

function model(ref: string, extra: Partial<ListedModel> = {}): ListedModel {
  return {
    ref,
    label: ref.slice(ref.indexOf("/") + 1),
    provider: ref.slice(0, ref.indexOf("/")),
    source: "catalog",
    status: "not_installed",
    price: FREE,
    ...extra,
  };
}

const LOCAL: ListedModel[] = [
  model("ollama/gemma4:e4b", { label: "Gemma 4 E4B", size_gb: 6.6, fit: "fits", recommended: true }),
  model("ollama/qwen3:8b", { label: "Qwen3 8B", size_gb: 5.2, fit: "fits", tags: ["coding"] }),
  model("ollama/qwen3:14b", { label: "Qwen3 14B", size_gb: 9.3, fit: "fits" }),
];

const KEYED: { provider: string; status: "needs_key" }[] = [
  { provider: "anthropic", status: "needs_key" },
  { provider: "openai", status: "needs_key" },
];

/** A Mac with nothing: no Ollama, no model, no key. A fresh GOLEM_HOME. */
export const FRESH_LISTING: ModelListResult = {
  default: null,
  ram_gb: 36,
  disk_free_gb: 97,
  models: LOCAL,
  providers: [{ provider: "ollama", status: "not_installed" }, ...KEYED],
  setup: { ollama_installed: false, ollama_running: false, keys: [] },
};

/** Ollama is installed and stopped. */
export const STOPPED_LISTING: ModelListResult = {
  ...FRESH_LISTING,
  models: LOCAL.map((each) => ({ ...each, status: "server_down" as const })),
  providers: [{ provider: "ollama", status: "server_down" }, ...KEYED],
  setup: { ollama_installed: true, ollama_running: false, keys: [] },
};

/** Ollama runs and has no model yet. */
export const RUNNING_LISTING: ModelListResult = {
  ...FRESH_LISTING,
  providers: [{ provider: "ollama", status: "ready" }, ...KEYED],
  setup: { ollama_installed: true, ollama_running: true, keys: [] },
};

/** The default model was deleted from Ollama. */
export const GONE_LISTING: ModelListResult = {
  ...RUNNING_LISTING,
  default: "ollama/qwen3:8b",
  models: [
    ...LOCAL.slice(0, 1).map((each) => ({ ...each, status: "ready" as const, source: "installed" as const })),
    ...LOCAL.slice(1),
  ],
};

/** A setup that works. */
export const WORKING_LISTING: ModelListResult = {
  ...GONE_LISTING,
  default: "ollama/gemma4:e4b",
  setup: { ...RUNNING_LISTING.setup, default_status: "ready" },
};

/** The same, with an Anthropic key stored. */
export const KEYED_LISTING: ModelListResult = {
  ...RUNNING_LISTING,
  models: [...LOCAL, model("anthropic/claude-sonnet-5", { label: "Claude Sonnet 5.5", source: "remote", status: "ready" })],
  providers: [{ provider: "ollama", status: "ready" }, { provider: "anthropic", status: "ready" }, { provider: "openai", status: "needs_key" }],
  setup: { ollama_installed: true, ollama_running: true, keys: ["anthropic"] },
};

/** `setup.status` of a Mac with Ollama missing and no model chosen. */
export const STATUS_ROWS: SetupRow[] = [
  { part: "service", name: "service", state: "ok", detail: "launchd runs golem-daemon" },
  { part: "socket", name: "socket", state: "ok", detail: "answering" },
  { part: "engine", name: "ollama", state: "fail", detail: "Ollama is not installed", action: "install_ollama" },
  { part: "model", name: "model", state: "warn", detail: "no model chosen yet", action: "pick_model" },
  { part: "tools", name: "mcp github", state: "ok", detail: "runs github-mcp" },
  { part: "tools", name: "mcp fs", state: "ok", detail: "runs fs-mcp" },
  { part: "disk", name: "disk", state: "ok", detail: "97 GB free" },
];

/** `setup.status` of a setup that works. */
export const OK_ROWS: SetupRow[] = [
  { part: "service", name: "service", state: "ok", detail: "launchd runs golem-daemon" },
  { part: "socket", name: "socket", state: "ok", detail: "answering" },
  { part: "engine", name: "ollama", state: "ok", detail: "Ollama 0.12 · running" },
  { part: "model", name: "model", state: "ok", detail: "Gemma 4 E4B · default" },
  { part: "tools", name: "mcp github", state: "ok", detail: "runs github-mcp" },
  { part: "disk", name: "disk", state: "ok", detail: "97 GB free" },
];

const NOW = Date.parse("2026-11-01T12:00:00Z");
const EMPTY_PULLS: PullsSnapshot = { active: new Map(), failed: new Map() };

/** A third of Gemma 4 E4B, at 12 MB/s. */
export const DOWNLOAD_PULLS: PullsSnapshot = {
  active: new Map([
    [
      "ollama/gemma4:e4b",
      {
        status: "pulling",
        progress: 2.1 / 6.6,
        track: {
          completed: 2_100_000_000,
          total: 6_600_000_000,
          samples: [
            { at: NOW - 8_000, bytes: 2_004_000_000 },
            { at: NOW, bytes: 2_100_000_000 },
          ],
        },
      },
    ],
  ]),
  failed: new Map(),
};

export type SetupCase = { label: string; ui: SetupUi; ctx: PanelContext };

function at(window: SetupWindow, listing: ModelListResult, change: Partial<SetupUi> = {}): SetupUi {
  return { ...newSetupUi(window, listing), ...change };
}

const KEPT = pageServiceRow(STATUS_ROWS[0] ?? null, "0.5.0");

function ctx(listing: ModelListResult, extra: Partial<PanelContext> = {}): PanelContext {
  return { listing, rows: STATUS_ROWS, service: KEPT, pulls: EMPTY_PULLS, now: NOW, ...extra };
}

const ENGINE = guided("engine", "start");
const OLLAMA = guided("ollama", "start");
const MODEL = guided("model", "start");

/** The window in each state the page draws, for the gallery and its test. */
export const SETUP_CASES: SetupCase[] = [
  { label: "Overview", ui: at(OVERVIEW, FRESH_LISTING), ctx: ctx(FRESH_LISTING, { service: pageServiceRow(null, "0.5.0") }) },
  { label: "Engine, guided", ui: at(ENGINE, FRESH_LISTING), ctx: ctx(FRESH_LISTING) },
  {
    label: "Ollama installing",
    ui: at(OLLAMA, FRESH_LISTING, { ollama: { phase: "installing", since: NOW - 41_000, last: "==> Pouring ollama--0.12.0.arm64_sequoia.bottle.tar.gz" } }),
    ctx: ctx(FRESH_LISTING),
  },
  { label: "Ollama, no Homebrew", ui: at(OLLAMA, FRESH_LISTING, { ollama: { phase: "waiting", since: NOW - 64_000 } }), ctx: ctx(FRESH_LISTING) },
  { label: "Provider", ui: at(guided("provider", "start"), FRESH_LISTING, { path: "key" }), ctx: ctx(FRESH_LISTING) },
  { label: "Key", ui: at(guided("key", "start"), FRESH_LISTING, { path: "key", hosted: "anthropic", key: ASK_PAGE_KEY }), ctx: ctx(FRESH_LISTING) },
  { label: "Model, picking", ui: at(MODEL, RUNNING_LISTING), ctx: ctx(RUNNING_LISTING) },
  {
    label: "Model, downloading",
    ui: at(MODEL, RUNNING_LISTING, {
      model: { phase: "downloading", ref: "ollama/gemma4:e4b", label: "Gemma 4 E4B", pull: { completed: 0, total: null, samples: [] } },
    }),
    ctx: ctx(RUNNING_LISTING, { pulls: DOWNLOAD_PULLS }),
  },
  {
    label: "Model, download failed",
    ui: at(MODEL, RUNNING_LISTING, {
      model: { phase: "failed", ref: "ollama/gemma4:e4b", reason: "no space left on device", selected: 0, all: false },
    }),
    ctx: ctx(RUNNING_LISTING),
  },
  {
    label: "Ready",
    ui: at(guided("ready", "start"), WORKING_LISTING, { ready: { engine: "Ollama on this Mac", model: "Gemma 4 E4B · saved as default" } }),
    ctx: ctx(WORKING_LISTING),
  },
  { label: "Service, not kept", ui: at(single("service", "overview"), WORKING_LISTING), ctx: ctx(WORKING_LISTING, { service: pageServiceRow(null, "0.5.0") }) },
];

export type FormCase = { label: string; rows: FormRow[]; actions: SetupActionsState; providers: KeyProvider[] };

const key = (id: string, name: string, blurb: string, saved: boolean): KeyProvider => ({ id, name, blurb, saved });
const NO_KEYS = [key("anthropic", "Anthropic", "Claude", false), key("openai", "OpenAI", "GPT", false), key("google", "Google", "Gemini", false)];
const OPENAI_SAVED = [key("anthropic", "Anthropic", "Claude", false), key("openai", "OpenAI", "GPT", true), key("google", "Google", "Gemini", false)];

const NO_ACTION: SetupActionsState = { running: null, output: "", noBrew: false, error: null, from: null };

const PROBLEM_ROWS: SetupRow[] = [
  ...STATUS_ROWS.slice(0, 4),
  { part: "engine", name: "anthropic", state: "fail", detail: "no API key", action: "set_key", target: "anthropic" },
  ...STATUS_ROWS.slice(4),
];

/** Settings → Setup in the states the form draws, for the gallery. */
export const FORM_CASES: FormCase[] = [
  { label: "All set", rows: setupFormRows(OK_ROWS, KEPT), actions: NO_ACTION, providers: OPENAI_SAVED },
  { label: "All set, page kept by a job", rows: setupFormRows(OK_ROWS, KEPT, true), actions: NO_ACTION, providers: OPENAI_SAVED },
  { label: "All set, page run by hand", rows: setupFormRows(OK_ROWS, KEPT, false), actions: NO_ACTION, providers: OPENAI_SAVED },
  {
    label: "Ollama missing, service not kept, a key missing",
    rows: setupFormRows(PROBLEM_ROWS, pageServiceRow(null, "0.5.0")),
    actions: NO_ACTION,
    providers: NO_KEYS,
  },
  {
    label: "Installing Ollama",
    rows: setupFormRows(PROBLEM_ROWS, KEPT),
    actions: {
      ...NO_ACTION,
      running: "install",
      output: "==> Fetching ollama\n==> Downloading https://ghcr.io/v2/homebrew/core/ollama\n==> Pouring ollama--0.12.0.arm64_sequoia.bottle.tar.gz\n",
    },
    providers: NO_KEYS,
  },
  {
    label: "Install failed",
    rows: setupFormRows(PROBLEM_ROWS, KEPT),
    actions: { ...NO_ACTION, error: { action: "install", text: "Error: no space left on device" } },
    providers: OPENAI_SAVED,
  },
];
