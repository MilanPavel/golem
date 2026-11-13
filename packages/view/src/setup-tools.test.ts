import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpCatalogEntry } from "@golem/client";

import {
  toolsAdded,
  toolsFailed,
  toolsFailureChoices,
  toolsFailures,
  toolsLines,
  toolsOffer,
  toolsResult,
  toolsRetry,
  toolsRuntimeDone,
  toolsRuntimeOutput,
  toolsSetToken,
  toolsSettled,
  toolsSkipRow,
  toolsStart,
  toolsStatusText,
  toolsStep,
  toolsTick,
  toolsToAdd,
  toolsTokenCancelled,
  type ToolsState,
} from "./setup-tools.ts";

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

const HINT = "Make a token at github.com/settings/personal-access-tokens/new";
const FETCH = entry("fetch", { runtime: "uvx", missing: "uv" });
const CONTEXT7 = entry("context7", { missing: "node" });
const PLAYWRIGHT = entry("playwright", { missing: "node" });
const GITHUB = entry("github", {
  runtime: "url",
  auth: "token",
  starter: false,
  inputs: [{ id: "token", kind: "secret", label: "GitHub token", hint: HINT }],
});
const FILESYSTEM = entry("filesystem", { starter: false });
const CATALOG = [FILESYSTEM, FETCH, CONTEXT7, PLAYWRIGHT, GITHUB];

function ids(state: ToolsState): string[] {
  return toolsToAdd(state).map((row) => row.id);
}

/** Runs the effects the way a UI would, with `fail` ids refused. */
function run(start: ToolsState, fail: readonly string[] = []): ToolsState {
  let state = start;
  for (let guard = 0; guard < 20; guard += 1) {
    const next = toolsStep(state);
    state = next.state;
    const effect = next.effect;
    if (effect.kind === "none") {
      break;
    }
    if (effect.kind === "install") {
      state = toolsRuntimeOutput(state, effect.runtime, "==> Downloading\n");
      state = toolsRuntimeDone(state, effect.runtime, true, null);
    } else {
      state = fail.includes(effect.id) ? toolsFailed(state, effect.id, "the token was refused") : toolsAdded(state, effect.id, 2);
    }
  }
  return state;
}

test("the offer is the starters ticked, then GitHub unticked, with what each needs", () => {
  const state = toolsOffer(CATALOG, "guided");
  assert.deepEqual(
    state.rows.map((row) => [row.id, row.ticked]),
    [
      ["fetch", true],
      ["context7", true],
      ["playwright", true],
      ["github", false],
    ],
  );
  const lines = toolsLines(state);
  assert.deepEqual(lines[0], { kind: "title", text: "Give golem some tools?" });
  assert.deepEqual(lines.at(-1), { kind: "option", label: "[ ] Github", detail: "github things · needs a token", selected: false });
  assert.deepEqual(lines[3], { kind: "option", label: "[x] Fetch", detail: "fetch things · needs uv", selected: true });
  assert.deepEqual(ids(state), ["fetch", "context7", "playwright"]);
});

test("a ticked server that needs a token opens its field, and an empty token skips it", () => {
  let state = toolsTick(toolsOffer(CATALOG, "guided"), "github");
  assert.equal(state.phase, "token");
  const field = toolsLines(state, 4);
  assert.deepEqual(field[0], { kind: "title", text: "Github · token" });
  assert.ok(field.some((line) => line.kind === "text" && line.text === HINT));
  assert.ok(field.some((line) => line.kind === "field" && line.text === "••••"));
  assert.equal(JSON.stringify(field).includes("ghp_"), false);
  assert.equal(toolsTokenCancelled(state).phase, "offer");
  assert.equal(toolsTokenCancelled(state).rows.find((row) => row.id === "github")?.ticked, false);
  const skipped = toolsSetToken(state, "github", "  ");
  assert.equal(skipped.phase, "offer");
  assert.equal(skipped.rows.find((row) => row.id === "github")?.ticked, false);
  state = toolsSetToken(state, "github", " ghp_secret ");
  assert.equal(state.rows.find((row) => row.id === "github")?.ticked, true);
  assert.deepEqual(ids(state), ["fetch", "context7", "playwright", "github"]);
  const unticked = toolsTick(state, "github");
  assert.equal(unticked.rows.find((row) => row.id === "github")?.token, null);
  assert.equal(toolsTick(toolsOffer(CATALOG, "guided"), "fetch").rows[0]?.ticked, false);
});

test("Enter with nothing ticked starts nothing", () => {
  let state = toolsOffer(CATALOG, "guided");
  for (const id of ["fetch", "context7", "playwright"]) {
    state = toolsTick(state, id);
  }
  assert.equal(toolsStart(state), null);
});

test("a missing Node is installed once, then the servers are added, one by one", () => {
  let state = toolsStart(toolsOffer(CATALOG, "guided")) as ToolsState;
  assert.deepEqual(state.rows.map((row) => toolsStatusText(row)), ["waiting · needs uv", "waiting · needs Node", "waiting · needs Node", ""]);
  let step = toolsStep(state);
  assert.deepEqual(step.effect, { kind: "install", runtime: "uv" });
  assert.equal(toolsStatusText(step.state.rows[0] as never), "installing uv");
  state = toolsRuntimeOutput(step.state, "uv", "downloading 41 / 98 MB\r42 / 98 MB\n");
  assert.equal(toolsStatusText(state.rows[0] as never), "installing uv · 42 / 98 MB");
  state = toolsRuntimeDone(state, "uv", true, null);
  step = toolsStep(state);
  assert.equal(step.effect.kind, "add");
  assert.deepEqual(step.effect.kind === "add" && step.effect.params, { name: "fetch", catalog_id: "fetch", inputs: {}, secrets: {} });
  assert.equal(toolsStatusText(step.state.rows[0] as never), "adding");
  assert.equal(toolsStep(step.state).effect.kind, "none");
  state = toolsAdded(step.state, "fetch", 1);
  assert.equal(toolsStatusText(state.rows[0] as never), "added · 1 tool · on in every chat");
  step = toolsStep(state);
  assert.deepEqual(step.effect, { kind: "install", runtime: "node" });
  state = toolsRuntimeDone(step.state, "node", true, null);
  assert.deepEqual(state.rows.slice(1, 3).map((row) => row.missing), [null, null]);
  const done = run(state);
  assert.deepEqual(done.rows.slice(0, 3).map((row) => toolsStatusText(row)), ["added · 1 tool · on in every chat", "added · 2 tools · on in every chat", "added · 2 tools · on in every chat"]);
  assert.equal(toolsSettled(done), true);
  assert.deepEqual(toolsResult(done), { kind: "done" });
});

test("a failed Node install fails the rows that need it, and the others go on", () => {
  let state = toolsStart(toolsOffer(CATALOG, "guided")) as ToolsState;
  state = toolsRuntimeDone(state, "node", false, "brew is missing");
  assert.deepEqual(state.rows.map((row) => row.status.kind), ["waiting", "failed", "failed", "idle"]);
  assert.equal(toolsStatusText(state.rows[1] as never), "failed · brew is missing");
  assert.equal(toolsRuntimeDone(state, "node", false, null).rows[1]?.status.kind, "failed");
});

test("one failure keeps the others, and a retry with a new token adds it", () => {
  let state = toolsTick(toolsOffer(CATALOG, "guided"), "github");
  state = toolsSetToken(state, "github", "ghp_old");
  state = run(toolsStart(state) as ToolsState, ["github"]);
  assert.equal(toolsSettled(state), true);
  assert.equal(toolsResult(state), null);
  assert.deepEqual(toolsFailures(state).map((row) => row.id), ["github"]);
  const github = state.rows.find((row) => row.id === "github");
  assert.equal(github?.token, null);
  assert.equal(toolsStatusText(github as never), "failed · the token was refused");
  assert.deepEqual(toolsFailureChoices(github as never).map((choice) => choice.label), ["Paste a new token", "Skip Github", "Show the log"]);
  assert.equal(state.rows.filter((row) => row.status.kind === "added").length, 3);
  // No token, no retry.
  assert.equal(toolsRetry(state, "github", "").rows.at(-1)?.status.kind, "failed");
  const retried = toolsRetry(state, "github", "ghp_new");
  assert.equal(retried.rows.at(-1)?.status.kind, "waiting");
  const step = toolsStep(retried);
  assert.deepEqual(step.effect, {
    kind: "add",
    id: "github",
    params: { name: "github", catalog_id: "github", inputs: {}, secrets: { token: "ghp_new" } },
  });
  const done = toolsAdded(step.state, "github", 40);
  assert.deepEqual(toolsResult(done), { kind: "done" });
  assert.equal(done.rows.at(-1)?.token, null);
});

test("a row can be skipped while it waits or after it fails", () => {
  let state = toolsStart(toolsOffer(CATALOG, "guided")) as ToolsState;
  state = toolsSkipRow(state, "playwright");
  assert.equal(toolsStatusText(state.rows[2] as never), "skipped");
  const done = run(state);
  assert.deepEqual(done.rows.map((row) => row.status.kind), ["added", "added", "skipped", "idle"]);
  assert.deepEqual(toolsResult(done), { kind: "done" });
  const failed = run(toolsStart(toolsOffer(CATALOG, "guided")) as ToolsState, ["context7"]);
  const skipped = toolsSkipRow(failed, "context7");
  assert.deepEqual(toolsResult(skipped), { kind: "done" });
  // A row that was added stays.
  assert.equal(toolsSkipRow(skipped, "fetch").rows[0]?.status.kind, "added");
});

test("from /setup, servers already added show as done and are not added again", () => {
  const state = toolsOffer([{ ...FETCH, added: true }, CONTEXT7, GITHUB], "single");
  assert.equal(state.rows[0]?.already, true);
  assert.deepEqual(toolsLines(state)[0], { kind: "title", text: "Tools · 1 server" });
  assert.equal(toolsLines(state)[1]?.kind === "blank", true);
  assert.deepEqual(toolsLines(state)[2], { kind: "option", label: "[x] Fetch", detail: "added", selected: true });
  assert.deepEqual(ids(state), ["context7"]);
  assert.equal(toolsTick(state, "fetch"), state);
  assert.equal(toolsOffer([{ ...FETCH, added: true }], "guided").rows.length, 0);
});

test("an entry that can't be added, or asks for a folder, is not offered", () => {
  const entries = [
    entry("linear", { available: false, reason: "needs sign-in" }),
    entry("filesystem", { inputs: [{ id: "folder", kind: "path", label: "Folder", required: true }] }),
    FETCH,
  ];
  assert.deepEqual(toolsOffer(entries, "guided").rows.map((row) => row.id), ["fetch"]);
});

test("the running lines show each row's progress", () => {
  const state = run(toolsStart(toolsOffer(CATALOG, "guided")) as ToolsState);
  assert.deepEqual(toolsLines(state)[0], { kind: "row", mark: "ok", label: "Fetch", text: "added · 2 tools · on in every chat" });
  assert.equal(toolsLines(state).length, 3);
});
