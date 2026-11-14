import { golemBlock, pageServiceRow, setupFormRows, setupProblem, setupProblemState, type FormRow, type GolemBlock, type Mark } from "@golem/view";
import type { ListedModel, ModelListResult, SetupRow, SetupStatusResult } from "../../store/models.ts";
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

const KEPT = pageServiceRow(STATUS_ROWS[0] ?? null, "0.5.0");


/** What the daemon sends of where golem is installed: a Homebrew install of a Mac user. */
export const INSTALL_FACTS: Pick<SetupStatusResult, "install" | "paths" | "jobs"> = {
  install: {
    method: "homebrew",
    version: "0.13.1",
    binary: "/opt/homebrew/bin/golem",
    daemon_binary: "/opt/homebrew/opt/golem/libexec/golem-daemon/golem-daemon",
  },
  paths: {
    home: "/Users/ann/.golem",
    config: "/Users/ann/.golem/config.toml",
    logs: "/Users/ann/.golem/logs/golem.jsonl",
    socket: "/Users/ann/.golem/run/golem.sock",
  },
  jobs: [
    { label: "dev.golem.daemon", plist: "/Users/ann/Library/LaunchAgents/dev.golem.daemon.plist", loaded: true, pid: 4821 },
    { label: "dev.golem.web", plist: "/Users/ann/Library/LaunchAgents/dev.golem.web.plist", loaded: true, pid: 4833 },
  ],
};

export type FormCase = {
  label: string;
  rows: FormRow[];
  actions: SetupActionsState;
  providers: KeyProvider[];
  header: { mark: Mark; text: string };
  block: GolemBlock | null;
  /** The provider whose key line starts open. */
  openKey?: string;
};

const key = (id: string, name: string, blurb: string, saved: boolean): KeyProvider => ({ id, name, blurb, saved });
const keys = (saved: (id: string) => boolean): KeyProvider[] =>
  [
    ["anthropic", "Anthropic", "Claude"],
    ["openai", "OpenAI", "GPT"],
    ["google", "Google", "Gemini"],
    ["deepseek", "DeepSeek", "DeepSeek V3 and R1"],
    ["xai", "xAI", "Grok"],
    ["moonshot", "Moonshot", "Kimi"],
  ].map(([id = "", name = "", blurb = ""]) => key(id, name, blurb, saved(id)));
const NO_KEYS = keys(() => false);
const OPENAI_SAVED = keys((id) => id === "openai" || id === "xai");
const ALL_SAVED = keys(() => true);

const NO_ACTION: SetupActionsState = { running: null, output: "", noBrew: false, error: null, from: null };

const PROBLEM_ROWS: SetupRow[] = [
  ...STATUS_ROWS.slice(0, 4),
  { part: "engine", name: "anthropic", state: "fail", detail: "no API key", action: "set_key", target: "anthropic" },
  ...STATUS_ROWS.slice(4),
];

const HEAD_MARKS = { ok: "ok", warn: "attn", fail: "fail" } as const;
const BLOCK = golemBlock(INSTALL_FACTS);

function head(rows: SetupRow[]): FormCase["header"] {
  const line = setupProblem(rows) ?? "all set";
  return { mark: HEAD_MARKS[setupProblemState(rows)], text: line.charAt(0).toUpperCase() + line.slice(1) };
}

const OLLAMA_STOPPED: SetupRow[] = OK_ROWS.map((row) =>
  row.part === "engine"
    ? { ...row, state: "warn" as const, detail: "not running · models can't load", action: "start_ollama" as const }
    : row,
);

const ONE_FAILING: SetupRow[] = OK_ROWS.map((row) =>
  row.part === "engine" ? { ...row, state: "fail" as const, detail: "Ollama is not installed", action: "install_ollama" as const } : row,
);

/** Settings → Setup in the states the page draws, for the gallery. */
export const FORM_CASES: FormCase[] = [
  { label: "All set", rows: setupFormRows(OK_ROWS, KEPT, true), actions: NO_ACTION, providers: ALL_SAVED, header: head(OK_ROWS), block: BLOCK },
  {
    label: "Ollama stopped",
    rows: setupFormRows(OLLAMA_STOPPED, KEPT, true),
    actions: NO_ACTION,
    providers: OPENAI_SAVED,
    header: head(OLLAMA_STOPPED),
    block: BLOCK,
  },
  {
    label: "One failing row",
    rows: setupFormRows(ONE_FAILING, KEPT, true),
    actions: NO_ACTION,
    providers: OPENAI_SAVED,
    header: head(ONE_FAILING),
    block: BLOCK,
  },
  {
    label: "A key line open",
    rows: setupFormRows(OK_ROWS, KEPT, true),
    actions: NO_ACTION,
    providers: OPENAI_SAVED,
    header: head(OK_ROWS),
    block: BLOCK,
    openKey: "anthropic",
  },
  {
    label: "All set, page run by hand, an older daemon",
    rows: setupFormRows(OK_ROWS, KEPT, false),
    actions: NO_ACTION,
    providers: OPENAI_SAVED,
    header: head(OK_ROWS),
    block: null,
  },
  {
    label: "Ollama missing, service not kept, a key missing",
    rows: setupFormRows(PROBLEM_ROWS, pageServiceRow(null, "0.5.0")),
    actions: NO_ACTION,
    providers: NO_KEYS,
    header: head(PROBLEM_ROWS),
    block: BLOCK,
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
    header: head(PROBLEM_ROWS),
    block: BLOCK,
  },
  {
    label: "Install failed",
    rows: setupFormRows(PROBLEM_ROWS, KEPT),
    actions: { ...NO_ACTION, error: { action: "install", text: "Error: no space left on device" } },
    providers: OPENAI_SAVED,
    header: head(PROBLEM_ROWS),
    block: BLOCK,
  },
];
