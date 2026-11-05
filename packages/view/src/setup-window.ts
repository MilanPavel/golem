import type { ListedModel, ModelListResult, SetupRow } from "@golem/client";

import { firstRunChoice, hostedProviders, namesModel } from "./first-run.ts";

/**
 * The setup window, the same in the terminal and the browser. It is drawn in
 * docs/design/setup-window.md, and this file is its section G: the panels,
 * the navigation between them, and what each one shows.
 *
 * Guided mode walks Service, Engine, Model, and Ready. Single mode opens one
 * panel and goes back where it came from. The overview lists what is set up.
 * Nothing here draws: each panel gives lines, and each UI draws them its own way.
 */
export type SetupPanel = "service" | "engine" | "ollama" | "provider" | "key" | "model" | "ready";

export type SetupStep = "Service" | "Engine" | "Model" | "Ready";

export const SETUP_STEPS: readonly SetupStep[] = ["Service", "Engine", "Model", "Ready"];

const STEP_OF: Record<SetupPanel, SetupStep> = {
  service: "Service",
  engine: "Engine",
  ollama: "Engine",
  provider: "Engine",
  key: "Engine",
  model: "Model",
  ready: "Ready",
};

/** Where the window opened: the first start, `/setup`, a send with no model, or a command such as `/login`. */
export type SetupOrigin = "start" | "overview" | "send" | "chat";

export type SetupWindow =
  | { view: "overview" }
  | {
      view: "panel";
      mode: "guided" | "single";
      panel: SetupPanel;
      /** The panels before this one, for Esc. */
      trail: readonly SetupPanel[];
      origin: SetupOrigin;
    };

/** What a panel reports when it is done with. */
export type SetupResult =
  | { kind: "done" }
  | { kind: "cancelled" }
  | { kind: "local" }
  | { kind: "key" }
  | { kind: "later" }
  | { kind: "provider"; provider: string }
  | { kind: "background" };

/** What the navigation needs to know about golem as it is now. */
export type SetupFacts = { ollamaRunning: boolean };

export type SetupNext =
  | { kind: "window"; window: SetupWindow }
  | { kind: "chat"; background: boolean }
  | { kind: "quit" };

export type PanelWindow = Extract<SetupWindow, { view: "panel" }>;

export const OVERVIEW: SetupWindow = { view: "overview" };

/** Guided mode from `panel`. A guided start on Engine has Service behind it, so Esc shows it. */
export function guided(panel: SetupPanel, origin: SetupOrigin): PanelWindow {
  const trail: SetupPanel[] = panel === "engine" && origin !== "send" ? ["service"] : [];
  return { view: "panel", mode: "guided", panel, trail, origin };
}

/** One panel alone, from the overview or at the start. */
export function single(panel: SetupPanel, origin: SetupOrigin): PanelWindow {
  return { view: "panel", mode: "single", panel, trail: [], origin };
}

const CHAT: SetupNext = { kind: "chat", background: false };

/** The navigation table: which panel comes after `result`, in this window's mode. */
export function advance(window: SetupWindow, result: SetupResult, facts: SetupFacts): SetupNext {
  if (window.view === "overview") {
    return CHAT;
  }
  if (window.mode === "single") {
    // Provider and Key go together: an API key is added with both, alone.
    if (window.panel === "provider" && result.kind === "provider") {
      return { kind: "window", window: { ...window, panel: "key", trail: [...window.trail, "provider"] } };
    }
    if (result.kind === "cancelled" && window.trail.length > 0) {
      const before = window.trail.at(-1) ?? window.panel;
      return { kind: "window", window: { ...window, panel: before, trail: window.trail.slice(0, -1) } };
    }
    return window.origin === "overview" ? { kind: "window", window: OVERVIEW } : CHAT;
  }
  if (result.kind === "cancelled") {
    const before = window.trail.at(-1);
    if (before !== undefined) {
      return { kind: "window", window: { ...window, panel: before, trail: window.trail.slice(0, -1) } };
    }
    if (window.origin === "overview") {
      return { kind: "window", window: OVERVIEW };
    }
    return window.panel === "service" && window.origin === "start" ? { kind: "quit" } : CHAT;
  }
  const next = guidedNext(window.panel, result, facts);
  if (next === "chat" || next === "background") {
    return { kind: "chat", background: next === "background" };
  }
  return { kind: "window", window: { ...window, panel: next, trail: [...window.trail, window.panel] } };
}

function guidedNext(panel: SetupPanel, result: SetupResult, facts: SetupFacts): SetupPanel | "chat" | "background" {
  switch (panel) {
    case "service":
      return "engine";
    case "engine":
      if (result.kind === "later") {
        return "chat";
      }
      if (result.kind === "key") {
        return "provider";
      }
      return facts.ollamaRunning ? "model" : "ollama";
    case "ollama":
    case "key":
      return "model";
    case "provider":
      return "key";
    case "model":
      return result.kind === "background" ? "background" : "ready";
    case "ready":
      return "chat";
  }
}

export type StepState = "done" | "now" | "todo" | "skip";

export const STEP_MARKS: Record<StepState, string> = { done: "✓", now: "●", todo: "○", skip: "–" };

/** The stepper, in guided mode only. A send with no model skips Service. */
export function stepper(window: SetupWindow): { name: SetupStep; state: StepState }[] | null {
  if (window.view !== "panel" || window.mode !== "guided") {
    return null;
  }
  const at = SETUP_STEPS.indexOf(STEP_OF[window.panel]);
  return SETUP_STEPS.map((name, index) => {
    if (index === at) {
      return { name, state: "now" };
    }
    if (index > at) {
      return { name, state: "todo" };
    }
    return { name, state: window.origin === "send" && name === "Service" ? "skip" : "done" };
  });
}

/** The stepper in a small terminal: `2/4 Engine`. */
export function shortStepper(window: SetupWindow): string | null {
  if (window.view !== "panel" || window.mode !== "guided") {
    return null;
  }
  const step = STEP_OF[window.panel];
  return `${SETUP_STEPS.indexOf(step) + 1}/${SETUP_STEPS.length} ${step}`;
}

/** What the start opens, from the service and the model list. */
export type SetupStart =
  | { kind: "window"; window: SetupWindow; reason: string | null }
  | { kind: "auto"; model: ListedModel }
  | { kind: "none" };

/**
 * No service: guided from Service. No model chosen: guided from Engine, or the
 * only ready model without asking. A default that is gone: the Model panel
 * alone, saying which. Everything works: nothing.
 */
export function setupAtStart(serviceUp: boolean, listing: ModelListResult | null): SetupStart | null {
  if (!serviceUp) {
    return { kind: "window", window: guided("service", "start"), reason: null };
  }
  if (listing === null) {
    return null;
  }
  if (defaultGone(listing)) {
    return { kind: "window", window: single("model", "start"), reason: `${listing.default ?? ""} is no longer available` };
  }
  const choice = firstRunChoice(listing);
  if (choice === null) {
    return { kind: "none" };
  }
  if (choice.kind === "auto") {
    return { kind: "auto", model: choice.model };
  }
  return { kind: "window", window: guided("engine", "start"), reason: null };
}

/**
 * True when the default names a model that is gone: golem lists nothing by
 * that name, or it is a local model no longer downloaded. A stopped Ollama
 * is not gone: golem starts it.
 */
export function defaultGone(listing: ModelListResult): boolean {
  if (listing.default === null) {
    return false;
  }
  const named = listing.models.find((model) => namesModel(model, listing.default));
  return named === undefined || (named.provider === "ollama" && named.status === "not_installed");
}

/** The line a working start shows in place of the window. */
export function welcomeBack(model: string, chats: number): string {
  const sessions = chats === 0 ? "" : ` · ${chats} chat${chats === 1 ? "" : "s"} in /sessions`;
  return `welcome back · ${model}${sessions}`;
}

// The panels' lines. A UI draws each kind its own way.

export type Mark = "ok" | "fail" | "attn" | "spin";

export type SetupLine =
  | { kind: "blank" }
  | { kind: "title"; text: string }
  | { kind: "text"; text: string; dim?: boolean }
  | { kind: "status"; mark: Mark; text: string; right?: string }
  | { kind: "option"; label: string; detail: string; selected: boolean }
  | { kind: "row"; mark: Mark; label: string; text: string }
  /** A field being typed into, such as a hidden key. */
  | { kind: "field"; text: string };

export type Choice<T> = { id: T; label: string; detail: string };

export type MoveKey = "up" | "down";

/** Up and down stop at the ends. */
export function move(selected: number, count: number, key: MoveKey): number {
  return Math.min(Math.max(selected + (key === "up" ? -1 : 1), 0), Math.max(0, count - 1));
}

function options<T>(choices: readonly Choice<T>[], selected: number): SetupLine[] {
  return choices.map((choice, index) => ({
    kind: "option",
    label: choice.label,
    detail: choice.detail,
    selected: index === selected,
  }));
}

/** Seconds as the screens show them: `3s`, `1m 04s`. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

// Service

/** Who runs the service when it answers: launchd, this window, or someone else (a checkout's `uv run`). */
export type ServiceRunner = "launchd" | "window" | "other";

export type ServiceChoice = "install" | "session" | "keep" | "remove" | "retry" | "log" | "quit";

export type ServiceState =
  | { phase: "ask"; runner: ServiceRunner | null; selected: number }
  | { phase: "confirm"; selected: number }
  | { phase: "starting"; how: "install" | "session"; agent: boolean; since: number }
  | { phase: "running"; since: number }
  | { phase: "failed"; how: "install" | "session"; reason: string; next: string; selected: number; log: readonly string[] | null };

/** After this the wait is explained, and after the next the start counts as failed. */
export const SLOW_START_MS = 10_000;
export const START_TIMEOUT_MS = 45_000;
/**
 * `golem daemon install` runs the daemon's binary, and its first run after
 * `brew install` waits while macOS checks every library. That can take a
 * minute, so the install gets longer than the start.
 */
export const INSTALL_TIMEOUT_MS = 180_000;
/** How long `✓ service running` shows before Engine. */
export const RUNNING_PAUSE_MS = 500;

const FIRST_RUN_NOTE: SetupLine[] = [
  { kind: "text", text: "the first start takes longer while macOS checks", dim: true },
  { kind: "text", text: "the app. This happens once.", dim: true },
];

export function askService(runner: ServiceRunner | null): ServiceState {
  return { phase: "ask", runner, selected: 0 };
}

export function serviceChoices(state: ServiceState): Choice<ServiceChoice>[] {
  switch (state.phase) {
    case "ask":
      if (state.runner === null) {
        return [
          { id: "install", label: "Start it now and at every login", detail: "" },
          { id: "session", label: "Only while this terminal is open", detail: "" },
        ];
      }
      if (state.runner === "launchd") {
        return [
          { id: "keep", label: "Keep it", detail: "" },
          { id: "session", label: "Only while a terminal is open", detail: "" },
          { id: "remove", label: "Stop and remove it", detail: "" },
        ];
      }
      return [
        { id: "keep", label: "Keep it", detail: "" },
        { id: "install", label: "Start it at every login", detail: "" },
      ];
    case "confirm":
      return [
        { id: "remove", label: "Stop and remove it", detail: "golem quits" },
        { id: "keep", label: "Keep it", detail: "" },
      ];
    case "failed":
      return [
        { id: "retry", label: "Retry", detail: "" },
        { id: "log", label: "Show the log", detail: "" },
        { id: "quit", label: state.next.length > 0 ? `Quit · then run: ${state.next}` : "Quit", detail: "" },
      ];
    case "starting":
    case "running":
      return [];
  }
}

const RUNNER_TEXT: Record<ServiceRunner, string> = {
  launchd: "Service is running and starts at login.",
  window: "Service is running while this terminal is open.",
  other: "Service is running, started by hand.",
};

export function serviceLines(state: ServiceState, now: number): SetupLine[] {
  switch (state.phase) {
    case "ask":
      if (state.runner === null) {
        return [
          { kind: "title", text: "Welcome to golem." },
          { kind: "blank" },
          { kind: "text", text: "golem runs a small background service, so your chats" },
          { kind: "text", text: "keep going after you close this terminal." },
          { kind: "blank" },
          ...options(serviceChoices(state), state.selected),
        ];
      }
      return [
        { kind: "status", mark: "ok", text: RUNNER_TEXT[state.runner] },
        { kind: "blank" },
        ...options(serviceChoices(state), state.selected),
      ];
    case "confirm":
      return [
        { kind: "title", text: "Stop and remove golem's service?" },
        { kind: "text", text: "golem can't answer without it. golem daemon install brings it back.", dim: true },
        { kind: "blank" },
        ...options(serviceChoices(state), state.selected),
      ];
    case "starting": {
      const took = elapsed(now - state.since);
      const lines: SetupLine[] = [];
      if (state.how === "install") {
        lines.push(
          state.agent
            ? { kind: "status", mark: "ok", text: "launch agent installed" }
            : { kind: "status", mark: "spin", text: "installing the launch agent…", right: took },
        );
        if (!state.agent) {
          if (now - state.since >= SLOW_START_MS) {
            lines.push(...FIRST_RUN_NOTE);
          }
          return lines;
        }
      }
      lines.push({ kind: "status", mark: "spin", text: "starting the service…", right: took });
      if (now - state.since >= SLOW_START_MS) {
        lines.push(...FIRST_RUN_NOTE);
      } else {
        lines.push({ kind: "text", text: "waiting for it to answer", dim: true });
      }
      return lines;
    }
    case "running":
      return [{ kind: "status", mark: "ok", text: "service running" }];
    case "failed": {
      const lines: SetupLine[] = [
        { kind: "status", mark: "fail", text: "the service didn't start" },
        { kind: "text", text: state.reason, dim: true },
      ];
      if (state.log !== null) {
        lines.push({ kind: "blank" }, ...state.log.map((text): SetupLine => ({ kind: "text", text, dim: true })));
      }
      return [...lines, { kind: "blank" }, ...options(serviceChoices(state), state.selected)];
    }
  }
}

/** What the UI does after a key on the Service panel. */
export type ServiceEffect =
  | { kind: "none" }
  | { kind: "install" }
  | { kind: "session" }
  | { kind: "done" }
  | { kind: "remove" }
  | { kind: "log" }
  | { kind: "quit" };

export type PanelKey = MoveKey | "enter" | "back";

export function pressService(state: ServiceState, key: PanelKey, now: number): { state: ServiceState; effect: ServiceEffect } {
  const none = { kind: "none" } as const;
  if (state.phase === "starting" || state.phase === "running") {
    return { state, effect: none };
  }
  if (key === "back") {
    // Esc on the question to remove goes back to the question; elsewhere the window decides.
    return state.phase === "confirm" ? { state: askService("launchd"), effect: none } : { state, effect: none };
  }
  const choices = serviceChoices(state);
  if (key !== "enter") {
    return { state: { ...state, selected: move(state.selected, choices.length, key) }, effect: none };
  }
  const choice = choices[state.selected]?.id;
  switch (choice) {
    case "install":
      return { state: { phase: "starting", how: "install", agent: false, since: now }, effect: { kind: "install" } };
    case "session":
      return { state: { phase: "starting", how: "session", agent: false, since: now }, effect: { kind: "session" } };
    case "keep":
      return state.phase === "confirm"
        ? { state: askService("launchd"), effect: none }
        : { state, effect: { kind: "done" } };
    case "remove":
      return state.phase === "confirm"
        ? { state, effect: { kind: "remove" } }
        : { state: { phase: "confirm", selected: 1 }, effect: none };
    case "retry":
      if (state.phase !== "failed") {
        return { state, effect: none };
      }
      return {
        state: { phase: "starting", how: state.how, agent: false, since: now },
        effect: { kind: state.how },
      };
    case "log":
      return { state, effect: { kind: "log" } };
    case "quit":
      return { state, effect: { kind: "quit" } };
    case undefined:
      return { state, effect: none };
  }
}

/** The launch agent is in place: the service is starting now. */
export function agentInstalled(state: ServiceState, now: number): ServiceState {
  if (state.phase === "starting" || (state.phase === "failed" && state.how === "install")) {
    // An install that ends after the window gave up still starts the service.
    return { phase: "starting", how: "install", agent: true, since: now };
  }
  return state;
}

/** The service answered. */
export function serviceAnswered(state: ServiceState, now: number): ServiceState {
  return state.phase === "starting" ? { phase: "running", since: now } : state;
}

/** The start failed, with why and what to run next. */
export function serviceFailed(state: ServiceState, reason: string, next: string): ServiceState {
  const how = state.phase === "starting" || state.phase === "failed" ? state.how : "install";
  return { phase: "failed", how, reason, next, selected: 0, log: null };
}

/** A start that has waited too long. */
export function serviceTimedOut(state: ServiceState, now: number): boolean {
  if (state.phase !== "starting") {
    return false;
  }
  const limit = state.how === "install" && !state.agent ? INSTALL_TIMEOUT_MS : START_TIMEOUT_MS;
  return now - state.since >= limit;
}

export function withLog(state: ServiceState, log: readonly string[]): ServiceState {
  return state.phase === "failed" ? { ...state, log } : state;
}

// Engine

export type EngineChoice = "local" | "key" | "later";

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  groq: "Groq",
  together: "Together",
  ollama: "Ollama",
};

/** A provider as the screens name it. */
export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

/** A send with no model leaves out Later: the message waits for a model. */
export function engineChoices(origin: SetupOrigin, listing: ModelListResult | null): Choice<EngineChoice>[] {
  const hosted = listing === null ? [] : hostedProviders(listing).map(providerName);
  const names = hosted.length === 0 ? "a hosted provider" : hosted.slice(0, 4).join(", ") + (hosted.length > 4 ? "…" : "");
  const choices: Choice<EngineChoice>[] = [
    { id: "local", label: "On this Mac", detail: "private, free · uses Ollama" },
    { id: "key", label: "With an API key", detail: names },
  ];
  if (origin !== "send") {
    choices.push({ id: "later", label: "Later", detail: "golem can't answer until you pick" });
  }
  return choices;
}

/** The choice Enter takes first: an API key when one is stored, else this Mac. */
export function engineSelected(listing: ModelListResult | null): number {
  return listing !== null && (listing.setup.keys ?? []).length > 0 ? 1 : 0;
}

export function engineLines(origin: SetupOrigin, listing: ModelListResult | null, selected: number): SetupLine[] {
  const title = origin === "send" ? "Pick how golem thinks, then Enter sends your message." : "Where should golem think?";
  return [{ kind: "title", text: title }, { kind: "blank" }, ...options(engineChoices(origin, listing), selected)];
}

export function pressEngine(
  origin: SetupOrigin,
  listing: ModelListResult | null,
  selected: number,
  key: MoveKey | "enter",
): { selected: number; result: SetupResult | null } {
  const choices = engineChoices(origin, listing);
  if (key !== "enter") {
    return { selected: move(selected, choices.length, key), result: null };
  }
  const choice = choices[selected]?.id ?? "local";
  return { selected, result: { kind: choice } };
}

// Ready

export function readyLines(summary: { service: string; engine: string; model: string }): SetupLine[] {
  return [
    { kind: "status", mark: "ok", text: "golem is ready" },
    { kind: "blank" },
    { kind: "row", mark: "ok", label: "Service", text: summary.service },
    { kind: "row", mark: "ok", label: "Engine", text: summary.engine },
    { kind: "row", mark: "ok", label: "Model", text: summary.model },
    { kind: "blank" },
    { kind: "text", text: "/setup brings this back any time.", dim: true },
  ];
}

// Quit part way

export function quitLines(selected: number): SetupLine[] {
  return [
    { kind: "title", text: "Quit setup?" },
    { kind: "text", text: "The service stays on. /setup picks up where you left.", dim: true },
    { kind: "blank" },
    ...options(QUIT_CHOICES, selected),
  ];
}

export const QUIT_CHOICES: readonly Choice<"quit" | "keep">[] = [
  { id: "quit", label: "Quit to chat", detail: "" },
  { id: "keep", label: "Keep going", detail: "" },
];

// The overview

export type SetupAction = NonNullable<SetupRow["action"]>;

export type OverviewChoice =
  | { kind: "fix"; action: SetupAction; target: string | null; label: string }
  /** The service runs but is not kept at login: the Service panel alone says how. */
  | { kind: "service"; label: string }
  | { kind: "guided"; label: string };

/** The Service row, which the UI fills itself: the daemon can't answer while it is down. */
export function serviceRow(runner: ServiceRunner | null, version: string): SetupRow {
  if (runner === null) {
    return { part: "service", name: "service", state: "fail", detail: "not running", action: null };
  }
  const how = runner === "launchd" ? "starts at login" : runner === "window" ? "this terminal only" : "started by hand";
  const shown = version.length > 0 ? ` · ${version}` : "";
  return { part: "service", name: "service", state: "ok", detail: `running · ${how}${shown}` };
}

/** The command that keeps the service running at login. The page shows it to copy, since it never installs anything. */
export const KEEP_SERVICE_COMMAND = "golem daemon install";

/**
 * The Service row for a page that is connected, so the service runs. The page cannot tell who
 * started it, so the row keeps the daemon's launchd check: kept at login when that is ok, else
 * "not kept", which needs attention but is not a failure.
 */
export function pageServiceRow(daemonRow: SetupRow | null, version: string): SetupRow {
  const shown = version.length === 0 ? "" : ` · ${version.startsWith("v") ? version : `v${version}`}`;
  if (daemonRow?.state === "ok") {
    return { part: "service", name: "service", state: "ok", detail: `running${shown} · starts at login` };
  }
  return { part: "service", name: "service", state: "warn", detail: `running${shown} · not kept at login` };
}

/** The daemon's own service row in a `setup.status` result, if it sent one. */
export function daemonServiceRow(rows: readonly SetupRow[]): SetupRow | null {
  return rows.find((row) => row.part === "service" && row.name === "service") ?? null;
}

/** The page's Service panel: it runs now, and the command that keeps it so when it is not kept. */
export function pageServiceLines(service: SetupRow): SetupLine[] {
  const kept = service.state === "ok";
  return [
    { kind: "status", mark: "ok", text: "service running" },
    { kind: "text", text: service.detail, dim: true },
    { kind: "blank" },
    ...(kept
      ? [
          { kind: "text", text: "golem's service starts at login, so your chats keep going after you close this page." } as const,
          { kind: "blank" } as const,
        ]
      : [{ kind: "text", text: "To keep it running at login, run this in a terminal:" } as const]),
    { kind: "option", label: "Continue", detail: "", selected: true },
  ];
}

const PART_LABELS: Record<SetupRow["part"], string> = {
  service: "Service",
  socket: "Socket",
  config: "Config",
  engine: "Engine",
  model: "Model",
  tools: "Tools",
  disk: "Disk",
};

const PART_ORDER: readonly SetupRow["part"][] = ["service", "socket", "config", "engine", "model", "tools", "disk"];

const MARKS: Record<SetupRow["state"], Mark> = { ok: "ok", warn: "attn", fail: "fail" };

/**
 * The daemon's rows with the UI's own Service row in place of the daemon's
 * launchd one. Healthy tools fold into one line, and the socket and the
 * config show only when something is wrong with them.
 */
export function overviewRows(rows: readonly SetupRow[], service: SetupRow): SetupLine[] {
  const shown: SetupLine[] = [];
  let lastPart: SetupRow["part"] | null = null;
  const push = (part: SetupRow["part"], mark: Mark, text: string): void => {
    shown.push({ kind: "row", mark, label: part === lastPart ? "" : PART_LABELS[part], text });
    lastPart = part;
  };
  push("service", MARKS[service.state], service.detail);
  const tools = rows.filter((row) => row.part === "tools");
  // The design's order, whatever order the checks ran in.
  const ordered = [...rows].sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
  for (const row of ordered) {
    if (row.part === "service" || ((row.part === "socket" || row.part === "config") && row.state === "ok")) {
      continue;
    }
    if (row.part === "tools") {
      if (row === tools[0] && tools.every((each) => each.state === "ok")) {
        push("tools", "ok", `${tools.length} MCP server${tools.length === 1 ? "" : "s"}`);
      } else if (row.state !== "ok") {
        push("tools", MARKS[row.state], `${row.name} · ${row.detail}`);
      }
      continue;
    }
    const text = row.part === "engine" ? `${providerName(row.name)} · ${row.detail}` : row.detail;
    push(row.part, MARKS[row.state], text);
  }
  return shown;
}

function actionLabel(action: SetupAction, target: string | null): string | null {
  switch (action) {
    case "install_ollama":
      return "Install Ollama";
    case "start_ollama":
      return "Start Ollama";
    case "pick_model":
      return "Pick a model";
    case "set_key":
      return target === null ? "Add an API key" : `Add the ${providerName(target)} key`;
    case "edit_config":
      return null;
  }
}

/**
 * The fixes for what is wrong first, then what can always be done. A `service` row that
 * needs attention (only the page makes one) leads with the Service panel.
 */
export function overviewChoices(rows: readonly SetupRow[], service?: SetupRow): OverviewChoice[] {
  const choices: OverviewChoice[] = service?.state === "warn" ? [{ kind: "service", label: "Keep it running at login" }] : [];
  const seen = new Set<string>();
  const add = (action: SetupAction, target: string | null, label: string): void => {
    const key = `${action}:${target ?? ""}`;
    if (!seen.has(key) && !(action === "pick_model" && seen.has("pick_model:"))) {
      seen.add(action === "pick_model" ? "pick_model:" : key);
      choices.push({ kind: "fix", action, target, label });
    }
  };
  for (const row of rows) {
    const action = row.action ?? null;
    const label = action === null ? null : actionLabel(action, row.target ?? null);
    if (row.state !== "ok" && action !== null && label !== null) {
      add(action, row.target ?? null, label);
    }
  }
  add("pick_model", null, "Change model");
  add("set_key", null, "Add an API key");
  return [...choices, { kind: "guided", label: "Run setup again" }];
}

export function overviewLines(
  rows: readonly SetupRow[] | null,
  service: SetupRow,
  selected: number,
  notice: string | null,
): SetupLine[] {
  if (rows === null) {
    return [
      ...overviewRows([], service),
      { kind: "status", mark: "spin", text: "checking…" },
    ];
  }
  const lines: SetupLine[] = [...overviewRows(rows, service), { kind: "blank" }];
  if (notice !== null) {
    lines.push({ kind: "status", mark: "ok", text: notice }, { kind: "blank" });
  }
  return [
    ...lines,
    ...overviewChoices(rows, service).map(
      (choice, index): SetupLine => ({ kind: "option", label: choice.label, detail: "", selected: index === selected }),
    ),
  ];
}

/**
 * The band line for the first row that is wrong, or null when all is well.
 * The service is the band's own business, and no model chosen has its own line.
 */
export function setupBand(rows: readonly SetupRow[]): string | null {
  const wrong = rows.find((row) => row.state !== "ok" && row.part !== "service" && row.part !== "socket");
  if (wrong === undefined) {
    return null;
  }
  if (wrong.part === "model" && wrong.state === "warn") {
    return NO_MODEL_BAND;
  }
  const named = wrong.part === "engine" || wrong.part === "tools" || (wrong.part === "model" && wrong.name !== "model");
  const what = named ? `${providerName(wrong.name)}: ` : "";
  return `! ${what}${wrong.detail} · /setup`;
}

/** The band after Later, and after a start with nothing chosen. */
export const NO_MODEL_BAND = "no model yet · /setup to pick one";
