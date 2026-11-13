import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpCatalogEntry } from "@golem/client";
import {
  advance,
  guided,
  readyLines,
  single,
  toolsAdded,
  toolsFailed,
  toolsOffer,
  toolsRuntimeDone,
  toolsStep,
  type SetupLine,
  type ToolsState,
} from "@golem/view";

import type { Press } from "./keys.ts";
import { labelWidth, lineSpans, rowWidth, setupHint, setupInner, stepperSpans } from "./setup-frame.ts";
import {
  newToolsUi,
  pressTools,
  toolsHint,
  toolsKeyOf,
  toolsReadyText,
  toolsTyping,
  toolsView,
  type ToolsKey,
  type ToolsUi,
} from "./setup-frame-tools.ts";

function press(name: Press["name"], input = ""): Press {
  return { name, input, ctrl: false, meta: false };
}

function entry(id: string, extra: Partial<McpCatalogEntry> = {}): McpCatalogEntry {
  return {
    id,
    name: id,
    title: id[0]?.toUpperCase() + id.slice(1),
    description: `${id} things`,
    category: "web",
    homepage: "https://example.com",
    runtime: "npx",
    auth: "none",
    starter: true,
    ...extra,
  };
}

const CATALOG = [
  entry("fetch", { description: "read any web page" }),
  entry("context7", { description: "up-to-date library docs" }),
  entry("playwright", { description: "browse and test web pages", missing: "node" }),
  entry("github", {
    title: "GitHub",
    description: "repos, issues, pull requests",
    runtime: "url",
    auth: "token",
    starter: false,
    inputs: [{ id: "token", kind: "secret", label: "GitHub token", hint: "Make one at github.com/settings/personal-access-tokens/new" }],
  }),
];

function open(mode: "guided" | "single" = "guided", catalog = CATALOG): ToolsUi {
  return { ...newToolsUi(), state: toolsOffer(catalog, mode) };
}

function keys(ui: ToolsUi, ...pressed: ToolsKey[]): ToolsUi {
  return pressed.reduce((now, key) => pressTools(now, key).ui, ui);
}

const K = (kind: Exclude<ToolsKey["kind"], "text">): ToolsKey => ({ kind });
const typing = (text: string): ToolsKey => ({ kind: "text", text });

/** The text of every line of a view, as the frame would draw it at `columns`. */
function drawn(lines: readonly SetupLine[], columns = 80, rows = 24): string[] {
  const inner = setupInner(columns, rows);
  const labels = labelWidth(lines);
  return lines.map((line) => lineSpans(line, inner, 0, labels, rowWidth(lines)).map((span) => span.text).join(""));
}

function sees(ui: ToolsUi): { text: string[]; screen: string } {
  const view = toolsView(ui);
  return { text: drawn(view.lines), screen: view.screen };
}

test("keys: Space ticks, s skips, q quits, and a token field takes every letter", () => {
  assert.deepEqual(toolsKeyOf(press(null, " "), false), { kind: "space" });
  assert.deepEqual(toolsKeyOf(press(null, "s"), false), { kind: "skip" });
  assert.deepEqual(toolsKeyOf(press(null, "q"), false), { kind: "quit" });
  assert.deepEqual(toolsKeyOf(press("return"), false), { kind: "enter" });
  assert.deepEqual(toolsKeyOf(press("escape"), true), { kind: "back" });
  assert.deepEqual(toolsKeyOf(press(null, "s"), true), { kind: "text", text: "s" });
  assert.deepEqual(toolsKeyOf(press(null, "q"), true), { kind: "text", text: "q" });
  assert.equal(toolsKeyOf(press("up"), true), null);
  assert.deepEqual(toolsKeyOf(press("up"), false), { kind: "up" });
  assert.deepEqual(toolsKeyOf(press("backspace"), true), { kind: "delete" });
  assert.deepEqual(toolsKeyOf(press("ctrl-c"), true), { kind: "interrupt" });
  assert.equal(toolsKeyOf({ name: null, input: "s", ctrl: true, meta: false }, false), null);
});

test("H1: the offer lists the starters ticked and GitHub not, with Enter adding the ticked", () => {
  const view = sees(open());
  assert.equal(view.screen, "tools-offer");
  assert.deepEqual(view.text, [
    "Give golem some tools?",
    "They cost nothing until a chat turns one on.",
    " ",
    "› [x] Fetch       read any web page",
    "  [x] Context7    up-to-date library docs",
    "  [x] Playwright  browse and test web pages · needs Node",
    "  [ ] GitHub      repos, issues, pull requests · needs a token",
  ]);
  assert.equal(setupHint("tools-offer", guided("tools", "start"), 3), "Space ticks · Enter adds 3 · s skip · Esc back");
  assert.equal(toolsView(open()).adds, 3);
});

test("H2: ticking GitHub opens a hidden token field, and the token is never drawn", () => {
  let ui = keys(open(), K("down"), K("down"), K("down"), K("space"));
  assert.equal(toolsTyping(ui), true);
  ui = keys(ui, typing("ghp_secret"));
  const view = sees(ui);
  assert.equal(view.screen, "tools-token");
  assert.equal(view.text[0], "GitHub · token");
  assert.equal(view.text.join("\n").includes("ghp_secret"), false);
  assert.ok(view.text.includes("❯ ••••••••••▏"));
  assert.ok(view.text.includes("Make one at github.com/settings/personal-access-tokens/new"));
  assert.equal(toolsHint("tools-token", 0, true), "Enter keeps it · Esc back");
  ui = keys(ui, K("enter"));
  assert.equal(ui.typed, "");
  assert.equal(toolsView(ui).adds, 4);
  assert.equal(toolsTyping(ui), false);
});

test("H2: an empty token skips that server, and Esc leaves the field", () => {
  const empty = keys(open(), K("down"), K("down"), K("down"), K("space"), K("enter"));
  assert.equal(empty.state?.rows[3]?.ticked, false);
  assert.equal(toolsView(empty).adds, 3);
  const back = keys(open(), K("down"), K("down"), K("down"), K("space"), typing("abc"), K("back"));
  assert.equal(back.typed, "");
  assert.equal(back.state?.phase, "offer");
});

test("H3: adding names each row, Node first, and Esc stops what waits", () => {
  let ui = pressTools(open(), K("enter")).ui;
  assert.equal(pressTools(open(), K("enter")).act.kind, "step");
  let state = ui.state as ToolsState;
  state = toolsStep(state).state;
  ui = { ...ui, state: toolsAdded(state, "fetch", 1) };
  ui = { ...ui, state: toolsStep(ui.state as ToolsState).state };
  ui = { ...ui, state: toolsAdded(ui.state as ToolsState, "context7", 2) };
  const step = toolsStep(ui.state as ToolsState);
  assert.equal(step.effect.kind, "install");
  ui = { ...ui, state: step.state };
  const view = sees(ui);
  assert.equal(view.screen, "tools-adding");
  assert.deepEqual(view.text.slice(0, 2), ["Adding 3 tools", " "]);
  assert.ok(view.text.some((line) => line.startsWith("✓ Fetch")));
  assert.ok(view.text.some((line) => line.startsWith("⠋ Playwright") && line.includes("installing Node")));
  assert.equal(setupHint(view.screen as "tools-adding", guided("tools", "start")), "Esc stops");
  const stopped = pressTools(ui, K("back"));
  assert.deepEqual(stopped.act, { kind: "stop", runtime: "node" });
  assert.equal(stopped.ui.state?.rows.find((row) => row.id === "playwright")?.status.kind, "skipped");
});

test("H4: when all are added, Enter continues and the footer says every chat", () => {
  let state = pressTools(open(), K("enter")).ui.state as ToolsState;
  for (const [id, count] of [["fetch", 1], ["context7", 2], ["playwright", 21]] as const) {
    state = toolsStep(state).state;
    if (id === "playwright") {
      state = toolsRuntimeDone(state, "node", true, null);
      state = toolsStep(state).state;
    }
    state = toolsAdded(state, id, count);
  }
  const ui: ToolsUi = { ...newToolsUi(), state };
  const view = sees(ui);
  assert.equal(view.screen, "tools-added");
  assert.deepEqual(view.text.slice(0, 3), [
    "✓ Fetch      added · 1 tool · on in every chat",
    "✓ Context7   added · 2 tools · on in every chat",
    "✓ Playwright added · 21 tools · on in every chat",
  ]);
  assert.ok(view.text.includes("On in every chat. Turn one off, or make it"));
  assert.equal(toolsHint(view.screen as "tools-added", 0, true), "Enter continues");
  assert.deepEqual(pressTools(ui, K("enter")).act, { kind: "leave", result: { kind: "done" } });
  assert.deepEqual(pressTools(ui, K("back")).act, { kind: "none" });
});

test("H5: a failure keeps the others, and offers a new token, Skip, and the log", () => {
  let state = pressTools(keys(open(), K("down"), K("down"), K("down"), K("space"), typing("bad"), K("enter")), K("enter")).ui
    .state as ToolsState;
  const secret = "bad";
  for (let guard = 0; guard < 12; guard += 1) {
    const stepped = toolsStep(state);
    state = stepped.state;
    if (stepped.effect.kind === "none") {
      break;
    }
    if (stepped.effect.kind === "install") {
      state = toolsRuntimeDone(state, "node", true, null);
    } else if (stepped.effect.id === "github") {
      state = toolsFailed(state, "github", "the token was refused");
    } else {
      state = toolsAdded(state, stepped.effect.id, 1);
    }
  }
  const ui: ToolsUi = { ...newToolsUi(), state, created: ["fetch", "context7", "playwright"] };
  const view = sees(ui);
  assert.equal(view.screen, "tools-failed");
  assert.ok(view.text.some((line) => line.startsWith("✗ GitHub") && line.includes("failed · the token was refused")));
  assert.equal(view.text.filter((line) => line.startsWith("✓")).length, 3);
  assert.ok(view.text.includes("› Paste a new token"));
  assert.ok(view.text.includes("  Skip GitHub"));
  assert.ok(view.text.includes("  Show the log"));
  assert.equal(view.text.join("\n").includes(secret), false);
  assert.equal(setupHint("tools-failed", guided("tools", "start")), "Enter picks · ↑↓ move · Esc back");
  // A new token retries the row, and the field shows dots.
  const field = keys(ui, K("enter"));
  assert.equal(field.retry, "github");
  assert.equal(sees(keys(field, typing("fresh"))).text.join("\n").includes("fresh"), false);
  const retried = pressTools(keys(field, typing("fresh")), K("enter"));
  assert.deepEqual(retried.act, { kind: "step" });
  assert.equal(retried.ui.state?.rows.find((row) => row.id === "github")?.status.kind, "waiting");
  // Skip drops the row, and takes out a server this panel saved.
  const skipped = pressTools({ ...ui, created: ["github"] }, K("down"));
  const skip = pressTools(pressTools(ui, K("down")).ui, K("enter"));
  assert.deepEqual(skip.act, { kind: "none" });
  assert.equal(skip.ui.state?.rows.find((row) => row.id === "github")?.status.kind, "skipped");
  assert.deepEqual(pressTools(pressTools({ ...ui, created: ["github"] }, K("down")).ui, K("enter")).act, { kind: "remove", name: "github" });
  assert.equal(skipped.act.kind, "none");
  // The log is the daemon's to read.
  const log = pressTools(keys(ui, K("down"), K("down")), K("enter"));
  assert.deepEqual(log.act, { kind: "logs", id: "github" });
  const shown = sees({ ...ui, log: { title: "GitHub · log", lines: ["12:00:00 stderr 401"] } });
  assert.deepEqual(shown.text, ["GitHub · log", " ", "12:00:00 stderr 401"]);
  assert.equal(pressTools({ ...ui, log: { title: "x", lines: [] } }, K("back")).ui.log, null);
  // Esc goes back, and Enter on the failed screen never continues.
  assert.deepEqual(pressTools(ui, K("back")).act, { kind: "leave", result: { kind: "cancelled" } });
});

test("a server that needs no token retries without one", () => {
  const catalog = [entry("fetch")];
  const ui = pressTools(open("guided", catalog), K("enter")).ui;
  const stepped = toolsStep(ui.state as ToolsState).state;
  const failed: ToolsUi = { ...ui, state: toolsFailed(stepped, "fetch", "uvx is missing") };
  assert.ok(sees(failed).text.includes("› Try Fetch again"));
  const retry = pressTools(failed, K("enter"));
  assert.deepEqual(retry.act, { kind: "step" });
});

test("H6: from /setup the servers already added show as done, and more is in /mcp", () => {
  const catalog = CATALOG.map((each) => (each.id === "github" ? each : { ...each, added: true }));
  const ui = open("single", catalog);
  const view = sees(ui);
  assert.equal(view.text[0], "Tools · 3 servers");
  assert.ok(view.text.some((line) => /^› \[x\] Fetch +added$/.test(line)));
  assert.ok(view.text.some((line) => /^ {2}\[ \] GitHub +repos, issues, pull requests · needs a token$/.test(line)));
  assert.ok(view.text.includes("More servers: close this and type /mcp"));
  assert.equal(setupHint("tools-offer", single("tools", "overview"), 1), "Space ticks · Enter adds 1 · Esc back");
  assert.deepEqual(pressTools(ui, K("skip")).act, { kind: "none" });
  assert.deepEqual(pressTools(ui, K("enter")).act, { kind: "none" });
});

test("Esc on the offer goes back, and s skips only in guided mode", () => {
  assert.deepEqual(pressTools(open(), K("back")).act, { kind: "leave", result: { kind: "cancelled" } });
  assert.deepEqual(pressTools(open(), K("skip")).act, { kind: "leave", result: { kind: "skip" } });
  assert.equal(toolsHint("tools-offer", 0, true), "Space ticks · s skip · Esc back");
});

test("an offer that could not be read says why, and Enter skips it", () => {
  const ui: ToolsUi = { ...newToolsUi(), error: "not connected" };
  assert.deepEqual(sees(ui).text, ["Tools", " ", "Couldn't read the tools: not connected"]);
  assert.deepEqual(pressTools(ui, K("enter")).act, { kind: "leave", result: { kind: "skip" } });
  assert.deepEqual(pressTools(newToolsUi(), K("back")).act, { kind: "leave", result: { kind: "cancelled" } });
});

test("a small terminal draws the same lines with no border", () => {
  const view = toolsView(open());
  const text = drawn(view.lines, 50, 15);
  assert.equal(text.length, view.lines.length);
  assert.equal(setupInner(50, 15), 50);
  assert.equal(setupHint("tools-offer", guided("tools", "start"), 3).split(" · ").length, 4);
});

test("guided setup on a fresh home reaches Tools, and Enter adds the three starters", () => {
  // Model's done goes to Tools when the config has no [mcp] table.
  const from = guided("model", "start");
  const next = advance(from, { kind: "done" }, { ollamaRunning: true, mcpEmpty: true });
  assert.equal(next.kind, "window");
  const window = next.kind === "window" ? next.window : from;
  assert.equal(window.view === "panel" && window.panel, "tools");
  const names = stepperSpans(window, { ollamaRunning: true, mcpEmpty: true })?.map((span) => span.text);
  assert.ok(names?.includes("● Tools"));
  // The catalog adds nothing by itself: Enter turns the ticked rows into three `mcp.add` calls.
  let state = pressTools(open("guided", CATALOG.filter((each) => each.id !== "playwright" || true)), K("enter")).ui.state as ToolsState;
  const added: string[] = [];
  for (let guard = 0; guard < 12; guard += 1) {
    const stepped = toolsStep(state);
    state = stepped.state;
    if (stepped.effect.kind === "none") {
      break;
    }
    if (stepped.effect.kind === "install") {
      state = toolsRuntimeDone(state, stepped.effect.runtime, true, null);
    } else {
      assert.equal(stepped.effect.params.catalog_id, stepped.effect.id);
      assert.deepEqual(stepped.effect.params.secrets, {});
      added.push(stepped.effect.id);
      state = toolsAdded(state, stepped.effect.id, 1);
    }
  }
  assert.deepEqual(added, ["fetch", "context7", "playwright"]);
  const ui: ToolsUi = { ...newToolsUi(), state };
  const done = pressTools(ui, K("enter")).act;
  assert.deepEqual(done, { kind: "leave", result: { kind: "done" } });
  const after = advance(window, { kind: "done" }, { ollamaRunning: true, mcpEmpty: true });
  assert.equal(after.kind === "window" && after.window.view === "panel" && after.window.panel, "ready");
});

test("the stepper shows Tools as passed over unless the config has none", () => {
  const texts = (mcpEmpty: boolean) =>
    stepperSpans(guided("model", "start"), { ollamaRunning: true, mcpEmpty })?.map((span) => span.text);
  assert.ok(texts(true)?.includes("○ Tools"));
  assert.ok(texts(false)?.includes("– Tools"));
});

test("Ready shows the Tools row only when Tools ran or servers exist", () => {
  const base = { service: "running", engine: "Ollama on this Mac", model: "Gemma 4 E4B · saved as default" };
  assert.equal(readyLines(base).some((line) => line.kind === "row" && line.label === "Tools"), false);
  assert.equal(toolsReadyText([], []), null);
  assert.equal(toolsReadyText(["Fetch", "Context7"], []), "Fetch, Context7 · on in every chat");
  assert.equal(toolsReadyText([], ["github"]), "github");
  const row = readyLines({ ...base, tools: toolsReadyText(["Fetch", "Context7", "Playwright"], []) }).find(
    (line) => line.kind === "row" && line.label === "Tools",
  );
  assert.deepEqual(row && row.kind === "row" && row.text, "Fetch, Context7, Playwright · on in every chat");
});
