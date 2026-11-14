import assert from "node:assert/strict";
import { test } from "node:test";

import type { SetupRow } from "@golem/client";

import { setupFormRows } from "./setup-form.ts";
import { pageServiceRow } from "./setup-window.ts";

function row(part: SetupRow["part"], name: string, state: SetupRow["state"], detail: string, extra: Partial<SetupRow> = {}): SetupRow {
  return { part, name, state, detail, ...extra };
}

const SERVICE = row("service", "service", "ok", "launchd runs golem-daemon");
const KEPT = pageServiceRow(SERVICE, "0.5.0");
const NOT_KEPT = pageServiceRow(null, "0.5.0");

const byPart = (cards: ReturnType<typeof setupFormRows>, part: SetupRow["part"]) => cards.filter((card) => card.part === part);

test("the cards follow the design's order, whatever order the checks ran in", () => {
  const rows = [
    row("disk", "disk", "ok", "97 GB free"),
    row("tools", "mcp fs", "ok", "runs fs-mcp"),
    row("model", "model", "ok", "Gemma 4 E4B · default"),
    row("engine", "ollama", "ok", "running"),
    SERVICE,
  ];
  assert.deepEqual(
    setupFormRows(rows, KEPT).map((card) => card.part),
    ["service", "engine", "model", "tools", "disk"],
  );
});

test("each mark has its word, and the names are the screens' own", () => {
  const rows = [
    row("engine", "ollama", "fail", "Ollama is not installed", { action: "install_ollama" }),
    row("engine", "anthropic", "warn", "key only in $ANTHROPIC_API_KEY", { action: "set_key", target: "anthropic" }),
    row("model", "model", "ok", "Gemma 4 E4B · default"),
    row("model", "model ollama/qwen3:8b", "fail", "not downloaded", { action: "pick_model", target: "ollama/qwen3:8b" }),
    row("disk", "disk", "ok", "97 GB free"),
  ];
  const cards = setupFormRows(rows, KEPT);
  assert.deepEqual(
    cards.map((card) => [card.name, card.mark, card.markWord]),
    [
      ["Service", "ok", "done"],
      ["Ollama", "fail", "failed"],
      ["Anthropic", "warn", "needs attention"],
      ["Model", "ok", "done"],
      ["Model ollama/qwen3:8b", "fail", "failed"],
      ["Tools", "ok", "done"],
      ["Disk", "ok", "done"],
    ],
  );
});

test("the service runs and is kept: no fix. Not kept: the command to run, never a button that installs it", () => {
  assert.equal(setupFormRows([], KEPT)[0]?.fix, null);
  const [card] = setupFormRows([SERVICE], NOT_KEPT);
  assert.equal(card?.mark, "warn");
  assert.deepEqual(card?.fix, { kind: "command", text: "golem install" });
  assert.match(card?.detail ?? "", /not kept at login/);
});

test("the Web page card follows Service: kept has no fix, not kept names the web command, unknown has no card", () => {
  const names = (kept: boolean | null) =>
    setupFormRows([], KEPT, kept)
      .map((card) => card.name)
      .filter((name) => name !== "Tools");
  assert.deepEqual(names(null), ["Service"]);
  assert.deepEqual(names(true), ["Service", "Web page"]);
  const [, kept] = setupFormRows([], KEPT, true);
  assert.equal(kept?.mark, "ok");
  assert.equal(kept?.detail, "kept running · starts at login");
  assert.equal(kept?.fix, null);
  const [, bare] = setupFormRows([], KEPT, false);
  assert.equal(bare?.mark, "warn");
  assert.equal(bare?.detail, "runs only while a terminal runs golem");
  assert.deepEqual(bare?.fix, { kind: "command", text: "golem web install", recheck: false });
});

test("when neither job is kept both cards name golem install", () => {
  const [service, bare] = setupFormRows([], NOT_KEPT, false);
  assert.deepEqual(service?.fix, { kind: "command", text: "golem install" });
  assert.deepEqual(bare?.fix, { kind: "command", text: "golem install", recheck: false });
});

test("each card keeps its own command when the other job is kept or unknown", () => {
  for (const pageKept of [true, null]) {
    const [service] = setupFormRows([], NOT_KEPT, pageKept);
    assert.deepEqual(service?.fix, { kind: "command", text: "golem install" });
  }
  const [, bare] = setupFormRows([], KEPT, false);
  assert.deepEqual(bare?.fix, { kind: "command", text: "golem web install", recheck: false });
});

test("without the page's service row the daemon's own is shown, and a missing one leaves none", () => {
  assert.equal(setupFormRows([SERVICE])[0]?.detail, "launchd runs golem-daemon");
  assert.equal(byPart(setupFormRows([]), "service").length, 0);
});

test("install_ollama and start_ollama become buttons, even when the engine is fine", () => {
  const install = row("engine", "ollama", "fail", "Ollama is not installed", { action: "install_ollama" });
  const start = row("engine", "ollama", "ok", "installed, not running, golem starts it", { action: "start_ollama" });
  assert.deepEqual(setupFormRows([install], KEPT)[1]?.fix, { kind: "button", id: "install_ollama", label: "Install Ollama" });
  assert.deepEqual(setupFormRows([start], KEPT)[1]?.fix, { kind: "button", id: "start_ollama", label: "Start Ollama" });
});

test("a running engine, and a provider with its key, have no fix", () => {
  const rows = [row("engine", "ollama", "ok", "running"), row("engine", "anthropic", "ok", "API key in the Keychain")];
  assert.deepEqual(
    byPart(setupFormRows(rows, KEPT), "engine").map((card) => card.fix),
    [null, null],
  );
});

test("set_key is the command to copy, for the provider the row names", () => {
  const missing = row("engine", "openai", "fail", "no API key", { action: "set_key", target: "openai" });
  const [, card] = setupFormRows([missing], KEPT);
  assert.equal(card?.name, "OpenAI");
  assert.deepEqual(card?.fix, { kind: "command", text: "golem auth set openai" });
});

test("pick_model: Change… when the model is fine, and Pick a model… when it is not", () => {
  const ok = row("model", "model", "ok", "Gemma 4 E4B · default");
  const none = row("model", "model", "warn", "no model chosen yet", { action: "pick_model" });
  assert.deepEqual(byPart(setupFormRows([ok], KEPT), "model")[0]?.fix, { kind: "button", id: "change_model", label: "Change…" });
  assert.deepEqual(byPart(setupFormRows([none], KEPT), "model")[0]?.fix, { kind: "button", id: "change_model", label: "Pick a model…" });
});

test("edit_config says where to edit, and offers Check again; an ok config and socket stay out", () => {
  const bad = row("config", "config", "fail", "mcp: bad value", { fix: "edit /Users/you/.golem/config.toml", action: "edit_config" });
  const cards = setupFormRows([bad, row("socket", "socket", "ok", "answering")], KEPT);
  assert.deepEqual(
    cards.filter((card) => card.part === "socket" || card.part === "config").map((card) => card.part),
    ["config"],
  );
  const config = byPart(cards, "config")[0];
  assert.equal(config?.detail, "mcp: bad value · edit /Users/you/.golem/config.toml");
  assert.deepEqual(config?.fix, { kind: "button", id: "check_again", label: "Check again" });
});

test("a socket that does not answer shows, with no fix", () => {
  const [, socket] = setupFormRows([row("socket", "socket", "fail", "not answering")], KEPT);
  assert.equal(socket?.part, "socket");
  assert.equal(socket?.fix, null);
});

test("a disk row has no fix", () => {
  const rows = [row("disk", "disk", "fail", "2.0 GB free", { fix: "free some space" })];
  assert.equal(byPart(setupFormRows(rows, KEPT), "disk")[0]?.fix, null);
});

test("no tool servers: one card that says so, with a button to add tools in place", () => {
  const [tools] = byPart(setupFormRows([], KEPT), "tools");
  assert.equal(tools?.detail, "no MCP servers yet");
  assert.equal(tools?.mark, "ok");
  assert.deepEqual(tools?.fix, { kind: "button", id: "add_tools", label: "Add tools" });
});

test("healthy tool servers fold into a count with Manage", () => {
  const one = [row("tools", "mcp fs", "ok", "runs fs-mcp")];
  const two = [...one, row("tools", "mcp github", "ok", "runs github-mcp")];
  assert.equal(byPart(setupFormRows(one, KEPT), "tools")[0]?.detail, "1 MCP server");
  const [tools] = byPart(setupFormRows(two, KEPT), "tools");
  assert.equal(tools?.detail, "2 MCP servers");
  assert.deepEqual(tools?.fix, { kind: "link", to: "/settings/mcp", label: "Manage" });
});

test("a tool server that is wrong has its own card, and the healthy ones fold away", () => {
  const rows = [row("tools", "mcp fs", "ok", "runs fs-mcp"), row("tools", "mcp github", "fail", "no token", { fix: "golem mcp edit" })];
  const cards = byPart(setupFormRows(rows, KEPT), "tools");
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.detail, "mcp github · no token");
  assert.equal(cards[0]?.mark, "fail");
  assert.equal(cards[0]?.fix?.kind, "link");
});

test("the rows are not changed", () => {
  const rows = [row("engine", "ollama", "ok", "running"), SERVICE];
  const copy = structuredClone(rows);
  setupFormRows(rows, KEPT);
  assert.deepEqual(rows, copy);
});
