import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelListResult, SetupRow } from "@golem/client";

import {
  advance,
  agentInstalled,
  askService,
  elapsed,
  engineChoices,
  engineSelected,
  guided,
  OVERVIEW,
  overviewChoices,
  overviewRows,
  pressEngine,
  pressService,
  serviceAnswered,
  serviceFailed,
  serviceLines,
  serviceRow,
  serviceTimedOut,
  setupAtStart,
  setupBand,
  shortStepper,
  single,
  SLOW_START_MS,
  START_TIMEOUT_MS,
  stepper,
  welcomeBack,
  withLog,
  type ServiceState,
  type SetupWindow,
} from "./setup-window.ts";

function model(ref: string, extra: Partial<ListedModel> = {}): ListedModel {
  return { ref, label: ref, provider: ref.slice(0, ref.indexOf("/")), source: "remote", status: "ready", ...extra };
}

const FRESH: ModelListResult = {
  default: null,
  ram_gb: 36,
  models: [model("ollama/qwen3:8b", { source: "catalog", status: "not_installed" }), model("anthropic/claude-x", { status: "needs_key" })],
  providers: [
    { provider: "anthropic", status: "needs_key" },
    { provider: "groq", status: "needs_key" },
    { provider: "ollama", status: "not_installed" },
  ],
  setup: { ollama_installed: false, ollama_running: false, keys: [], default_status: null },
};

const WORKING: ModelListResult = { ...FRESH, default: "ollama/qwen3:8b", models: [model("ollama/qwen3:8b")] };

const UP = { ollamaRunning: true };
const DOWN = { ollamaRunning: false };

function panelOf(next: ReturnType<typeof advance>): string {
  if (next.kind !== "window") {
    return next.kind === "chat" ? (next.background ? "chat+download" : "chat") : "quit";
  }
  return next.window.view === "overview" ? "overview" : next.window.panel;
}

test("guided mode walks the table: service, engine, then a path, model, ready, chat", () => {
  let window: SetupWindow = guided("service", "start");
  const step = (result: Parameters<typeof advance>[1], facts = DOWN): string => {
    const next = advance(window, result, facts);
    if (next.kind === "window") {
      window = next.window;
    }
    return panelOf(next);
  };
  assert.equal(step({ kind: "done" }), "engine");
  assert.equal(step({ kind: "local" }), "ollama");
  assert.equal(step({ kind: "done" }), "model");
  assert.equal(step({ kind: "done" }), "ready");
  assert.equal(step({ kind: "done" }), "chat");
  assert.equal(panelOf(advance(guided("engine", "start"), { kind: "local" }, UP)), "model");
  assert.equal(panelOf(advance(guided("engine", "start"), { kind: "key" }, UP)), "provider");
  assert.equal(panelOf(advance({ ...guided("engine", "start"), panel: "provider" }, { kind: "provider", provider: "groq" }, UP)), "key");
  assert.equal(panelOf(advance(guided("engine", "start"), { kind: "later" }, UP)), "chat");
  assert.equal(panelOf(advance({ ...guided("engine", "start"), panel: "model" }, { kind: "background" }, UP)), "chat+download");
});

test("Esc goes to the panel before; on Service at the start golem quits", () => {
  const engine = guided("engine", "start");
  const back = advance(engine, { kind: "cancelled" }, UP);
  assert.equal(panelOf(back), "service");
  assert.equal(panelOf(advance(guided("service", "start"), { kind: "cancelled" }, UP)), "quit");
  assert.equal(panelOf(advance(guided("service", "overview"), { kind: "cancelled" }, UP)), "overview");
  assert.equal(panelOf(advance(guided("engine", "send"), { kind: "cancelled" }, UP)), "chat");
});

test("a single panel goes back where it opened from", () => {
  assert.equal(panelOf(advance(single("model", "overview"), { kind: "done" }, UP)), "overview");
  assert.equal(panelOf(advance(single("model", "overview"), { kind: "cancelled" }, UP)), "overview");
  assert.equal(panelOf(advance(single("model", "start"), { kind: "done" }, UP)), "chat");
  assert.equal(panelOf(advance(OVERVIEW, { kind: "cancelled" }, UP)), "chat");
});

test("the stepper marks done, now and to do, and a send skips Service", () => {
  assert.deepEqual(
    stepper(guided("engine", "start"))?.map((step) => step.state),
    ["done", "now", "todo", "todo"],
  );
  assert.equal(stepper(guided("engine", "send"))?.[0]?.state, "skip");
  assert.equal(stepper(single("model", "overview")), null);
  assert.equal(stepper(OVERVIEW), null);
  assert.equal(shortStepper(guided("engine", "start")), "2/4 Engine");
  assert.equal(shortStepper({ ...guided("engine", "start"), panel: "key" }), "2/4 Engine");
});

test("the start opens Service, Engine, the Model alone, the one ready model, or nothing", () => {
  assert.deepEqual(setupAtStart(false, null), { kind: "window", window: guided("service", "start"), reason: null });
  assert.equal(setupAtStart(true, null), null);
  assert.deepEqual(setupAtStart(true, WORKING), { kind: "none" });
  assert.deepEqual(setupAtStart(true, FRESH), { kind: "window", window: guided("engine", "start"), reason: null });
  const gone = setupAtStart(true, { ...WORKING, default: "ollama/old:1b" });
  assert.deepEqual(gone, { kind: "window", window: single("model", "start"), reason: "ollama/old:1b is no longer available" });
  const deleted = { ...WORKING, models: [model("ollama/qwen3:8b", { source: "profile", status: "not_installed" })] };
  assert.equal(setupAtStart(true, deleted)?.kind, "window");
  const stopped = { ...WORKING, models: [model("ollama/qwen3:8b", { status: "server_down" })] };
  assert.deepEqual(setupAtStart(true, stopped), { kind: "none" });
  const one = setupAtStart(true, { ...WORKING, default: null });
  assert.equal(one?.kind, "auto");
});

test("welcome back names the model and the chats", () => {
  assert.equal(welcomeBack("Gemma 4 E4B", 12), "welcome back · Gemma 4 E4B · 12 chats in /sessions");
  assert.equal(welcomeBack("Gemma 4 E4B", 1), "welcome back · Gemma 4 E4B · 1 chat in /sessions");
  assert.equal(welcomeBack("Gemma 4 E4B", 0), "welcome back · Gemma 4 E4B");
});

test("elapsed reads as the screens show it", () => {
  assert.equal(elapsed(3_400), "3s");
  assert.equal(elapsed(64_000), "1m 04s");
});

test("the Service question installs or runs for this terminal, and each sub-step shows", () => {
  const ask = askService(null);
  assert.deepEqual(pressService(ask, "up", 0).state, ask);
  const install = pressService(ask, "enter", 1_000);
  assert.deepEqual(install.effect, { kind: "install" });
  assert.deepEqual(serviceLines(install.state, 3_000)[0], {
    kind: "status",
    mark: "spin",
    text: "installing the launch agent…",
    right: "2s",
  });
  const starting = agentInstalled(install.state, 2_000);
  const lines = serviceLines(starting, 5_000);
  assert.deepEqual(lines[0], { kind: "status", mark: "ok", text: "launch agent installed" });
  assert.deepEqual(lines[1], { kind: "status", mark: "spin", text: "starting the service…", right: "3s" });
  assert.equal(lines[2]?.kind === "text" && lines[2].text, "waiting for it to answer");
  const slow = serviceLines(starting, 2_000 + SLOW_START_MS);
  assert.ok(slow.some((line) => line.kind === "text" && line.text.includes("macOS checks")));
  assert.ok(!serviceTimedOut(starting, 2_000 + START_TIMEOUT_MS - 1));
  assert.ok(serviceTimedOut(starting, 2_000 + START_TIMEOUT_MS));
  assert.deepEqual(serviceAnswered(starting, 9_000), { phase: "running", since: 9_000 });
  const session = pressService(pressService(ask, "down", 0).state, "enter", 0);
  assert.deepEqual(session.effect, { kind: "session" });
});

test("a failed start offers retry, the log, and quit with the next command", () => {
  const failed = serviceFailed({ phase: "starting", how: "install", agent: true, since: 0 }, "data is from golem 0.6", "brew upgrade golem");
  const lines = serviceLines(failed, 0);
  assert.deepEqual(lines[0], { kind: "status", mark: "fail", text: "the service didn't start" });
  assert.ok(lines.some((line) => line.kind === "option" && line.label === "Quit · then run: brew upgrade golem"));
  assert.deepEqual(pressService(failed, "enter", 5).effect, { kind: "install" });
  const onLog = pressService(failed, "down", 0).state;
  assert.deepEqual(pressService(onLog, "enter", 0).effect, { kind: "log" });
  const shown = withLog(onLog, ["line one"]);
  assert.ok(serviceLines(shown, 0).some((line) => line.kind === "text" && line.text === "line one"));
});

test("run setup again keeps the service, or removes it after asking", () => {
  const running = askService("launchd");
  assert.deepEqual(pressService(running, "enter", 0).effect, { kind: "done" });
  const remove = pressService(pressService(pressService(running, "down", 0).state, "down", 0).state, "enter", 0);
  assert.equal(remove.state.phase, "confirm");
  assert.deepEqual(remove.effect, { kind: "none" });
  // The question starts on Keep it, so a quick Enter removes nothing.
  assert.deepEqual(pressService(remove.state, "enter", 0).state, askService("launchd"));
  const sure = pressService(remove.state, "up", 0).state;
  assert.deepEqual(pressService(sure, "enter", 0).effect, { kind: "remove" });
  assert.deepEqual(pressService(remove.state, "back", 0).state, askService("launchd"));
  const other: ServiceState = askService("other");
  assert.deepEqual(pressService(pressService(other, "down", 0).state, "enter", 0).effect, { kind: "install" });
});

test("the Engine panel offers three ways, a send leaves out Later, a key is suggested when stored", () => {
  assert.deepEqual(
    engineChoices("start", FRESH).map((choice) => choice.id),
    ["local", "key", "later"],
  );
  assert.equal(engineChoices("start", FRESH)[1]?.detail, "Anthropic, Groq");
  assert.deepEqual(
    engineChoices("send", FRESH).map((choice) => choice.id),
    ["local", "key"],
  );
  assert.equal(engineSelected(FRESH), 0);
  assert.equal(engineSelected({ ...FRESH, setup: { ...FRESH.setup, keys: ["groq"] } }), 1);
  assert.deepEqual(pressEngine("start", FRESH, 2, "enter"), { selected: 2, result: { kind: "later" } });
  assert.deepEqual(pressEngine("send", FRESH, 1, "down"), { selected: 1, result: null });
});

const ROWS: SetupRow[] = [
  { part: "service", name: "service", state: "ok", detail: "launchd runs golem-daemon" },
  { part: "config", name: "config", state: "ok", detail: "valid" },
  { part: "model", name: "model", state: "ok", detail: "new chats start on ollama/qwen3:8b" },
  { part: "engine", name: "ollama", state: "fail", detail: "Ollama is not installed", action: "install_ollama" },
  { part: "tools", name: "mcp github", state: "ok", detail: "runs github-mcp" },
  { part: "tools", name: "mcp fs", state: "ok", detail: "runs fs-mcp" },
  { part: "disk", name: "disk", state: "ok", detail: "97 GB free" },
];

test("the overview puts golem's own Service row first, folds healthy tools, and hides a fine config", () => {
  const lines = overviewRows(ROWS, serviceRow("launchd", "0.5.0"));
  assert.deepEqual(
    lines.map((line) => (line.kind === "row" ? `${line.mark} ${line.label} ${line.text}` : line.kind)),
    [
      "ok Service running · starts at login · 0.5.0",
      "fail Engine Ollama · Ollama is not installed",
      "ok Model new chats start on ollama/qwen3:8b",
      "ok Tools 2 MCP servers",
      "ok Disk 97 GB free",
    ],
  );
  assert.equal(serviceRow(null, "").state, "fail");
});

test("the overview offers the fix first, then Change model, Add an API key, and Run setup again", () => {
  assert.deepEqual(
    overviewChoices(ROWS).map((choice) => choice.label),
    ["Install Ollama", "Change model", "Add an API key", "Run setup again"],
  );
  const missing: SetupRow[] = [
    { part: "model", name: "model", state: "fail", detail: "gone", action: "pick_model", target: "ollama/a" },
    { part: "engine", name: "groq", state: "fail", detail: "no API key", action: "set_key", target: "groq" },
  ];
  assert.deepEqual(
    overviewChoices(missing).map((choice) => choice.label),
    ["Pick a model", "Add the Groq key", "Add an API key", "Run setup again"],
  );
});

test("the band names the first thing wrong, and says nothing when all is well", () => {
  assert.equal(setupBand(ROWS), "! Ollama: Ollama is not installed · /setup");
  assert.equal(setupBand(ROWS.filter((row) => row.state === "ok")), null);
  assert.equal(
    setupBand([{ part: "model", name: "model", state: "warn", detail: "no model chosen yet", action: "pick_model" }]),
    "no model yet · /setup to pick one",
  );
  assert.equal(setupBand([{ part: "service", name: "service", state: "fail", detail: "no job" }]), null);
  assert.equal(
    setupBand([{ part: "model", name: "model qwen3:8b", state: "fail", detail: "not downloaded", action: "pick_model" }]),
    "! model qwen3:8b: not downloaded · /setup",
  );
});
