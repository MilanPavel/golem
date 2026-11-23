import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedModel, ModelMemory, TraceMessage } from "@golem/client";

import {
  actionForKey,
  bestActions,
  contextActions,
  contextFillLine,
  contextKeyRow,
  cutBanner,
  suggestedAction,
  windowSourceLine,
  windowSourceOf,
  type ContextActionsInput,
} from "./context-actions.ts";

const msg = (role: TraceMessage["role"], tokens: number, extra: Partial<TraceMessage> = {}): TraceMessage => ({
  role,
  text: "x",
  tokens,
  ...extra,
});

/** Six turns, one tool result each, 3K tokens each: two results and two turns are old enough to act on. */
function history(turns = 6, results = turns): TraceMessage[] {
  const out: TraceMessage[] = [];
  for (let at = 0; at < turns; at += 1) {
    out.push(msg("user", 100), msg("assistant", 100));
    if (at < results) out.push(msg("tool", 3000));
  }
  return out;
}

const listed = (ref: string, extra: Partial<ListedModel> = {}): ListedModel => ({
  ref,
  label: ref.slice(ref.indexOf("/") + 1),
  provider: ref.slice(0, ref.indexOf("/")),
  source: "remote",
  status: "ready",
  tier: "budget",
  ...extra,
});

const OWN = listed("ollama/qwen3:27b", { tier: "local", source: "installed", ctx: 131072, price: { input: 0, output: 0 } });
const CHEAP = listed("deepseek/deepseek-chat", { ctx: 128000, price: { input: 0.28, output: 1.1 }, tools: true });
const MEMORY: ModelMemory = { ram_gb: 32, size_gb: 16, kv_gb_per_1k_tokens: 0.06, overhead_gb: 1, fits_share: 0.5, tight_share: 0.75 };

function input(extra: Partial<ContextActionsInput> = {}): ContextActionsInput {
  return {
    used: 26000,
    window: 32768,
    source: "planned",
    session: { profile: null, provider: "ollama", name: "qwen3:27b" },
    models: [OWN, CHEAP],
    messages: history(),
    keepResults: 4,
    keepTurns: 4,
    memory: MEMORY,
    route: "pinned",
    busy: false,
    ...extra,
  };
}

const row = (rows: ReturnType<typeof contextActions>, id: string) => rows.find((item) => item.id === id);

test("a local planned session gets all four rows, in order, each with its cost", () => {
  const rows = contextActions(input());
  assert.deepEqual(rows.map((item) => item.id), ["clear", "summarise", "grow", "larger"]);
  assert.ok(rows.every((item) => item.enabled));
  // Two of six results are older than the newest four: 2 x (3000 - 15).
  assert.equal(row(rows, "clear")?.consequence, "frees ≈ 6.0K · no model call");
  // Two old turns: 2 x (100 + 100 + 3000) less the summary.
  assert.equal(row(rows, "summarise")?.consequence, "frees ≈ 6.0K · one call to qwen3:27b");
  assert.equal(row(rows, "grow")?.label, "Grow the window to 64K");
  assert.equal(row(rows, "grow")?.consequence, "+1.9 GB memory · reloads the model");
  assert.equal(row(rows, "larger")?.consequence, "deepseek-chat · 128K · under $0.01 a turn · asks first");
});

test("under four tool results there is nothing to clear, and under four turns nothing to summarise", () => {
  const rows = contextActions(input({ messages: history(4, 3) }));
  assert.equal(row(rows, "clear")?.enabled, false);
  assert.equal(row(rows, "clear")?.why, "nothing to clear yet");
  assert.equal(row(rows, "summarise")?.enabled, false);
  assert.equal(row(rows, "summarise")?.why, "not enough turns yet");
});

test("results already cleared are not counted again", () => {
  const messages = [...history(6, 6)];
  for (const at of [2, 5]) messages[at] = msg("tool", 20, { original: "long" });
  const rows = contextActions(input({ messages }));
  // Six results, two already stubs: four live ones are all kept.
  assert.equal(row(rows, "clear")?.why, "nothing to clear yet");
});

test("while the last call is not read the first two rows wait", () => {
  const rows = contextActions(input({ messages: null }));
  assert.equal(row(rows, "clear")?.why, "reading the last call");
  assert.equal(row(rows, "summarise")?.enabled, false);
  assert.equal(row(rows, "grow")?.enabled, true);
});

test("a tokenless message is counted by its length", () => {
  const big: TraceMessage = { role: "tool", text: "x".repeat(40000) };
  const rows = contextActions(input({ messages: [...history(6, 0), big, big, big, big, big, big] }));
  assert.equal(row(rows, "clear")?.consequence, "frees ≈ 20.0K · no model call");
});

test("grow: a window set by you, and one golem did not plan, are disabled with the reason", () => {
  const user = contextActions(input({ source: "user" }));
  assert.equal(row(user, "grow")?.why, "the window is set by you (/tune)");
  assert.equal(row(user, "grow")?.label, "Grow the window");
  const ollama = contextActions(input({ source: "ollama" }));
  assert.equal(row(ollama, "grow")?.why, "golem has not planned a window for qwen3:27b");
  const unknown = contextActions(input({ source: "unknown", window: null }));
  assert.equal(row(unknown, "grow")?.enabled, false);
});

test("grow: when the Mac cannot hold the next step, or the model has no more room", () => {
  const small: ModelMemory = { ...MEMORY, ram_gb: 20 };
  assert.equal(row(contextActions(input({ memory: small })), "grow")?.why, "this Mac cannot hold more for qwen3:27b");
  const capped = [{ ...OWN, ctx: 32768 }, CHEAP];
  assert.equal(row(contextActions(input({ models: capped })), "grow")?.why, "this Mac cannot hold more for qwen3:27b");
  const top = contextActions(input({ window: 131072, used: 100000 }));
  assert.equal(row(top, "grow")?.enabled, false);
});

test("grow: a tight fit is allowed, and an unknown memory leaves the figure out", () => {
  const tight: ModelMemory = { ...MEMORY, ram_gb: 28 };
  assert.equal(row(contextActions(input({ memory: tight })), "grow")?.enabled, true);
  assert.equal(row(contextActions(input({ memory: null })), "grow")?.consequence, "reloads the model");
});

test("a hosted model has no grow row", () => {
  const rows = contextActions(
    input({ session: { profile: null, provider: "deepseek", name: "deepseek-chat" }, source: "unknown", window: 128000, models: [CHEAP, OWN] }),
  );
  assert.equal(row(rows, "grow"), undefined);
});

test("larger: none when no ready model has a larger window, and a free one says free", () => {
  assert.equal(row(contextActions(input({ models: [OWN] })), "larger"), undefined);
  assert.equal(row(contextActions(input({ models: [OWN, { ...CHEAP, status: "needs_key" }] })), "larger"), undefined);
  const free = listed("ollama/big", { tier: "local", ctx: 65536, price: { input: 0, output: 0 } });
  assert.equal(row(contextActions(input({ models: [OWN, free] })), "larger")?.consequence, "big · 64K · free");
  // The cheapest wins.
  const dear = listed("openrouter/dear", { tier: "frontier", ctx: 200000, price: { input: 5, output: 20 } });
  assert.equal(row(contextActions(input({ models: [OWN, dear, CHEAP] })), "larger")?.consequence.startsWith("deepseek-chat"), true);
});

test("larger: a smaller local model with a bigger window is not offered for a larger local model", () => {
  const own = { ...OWN, ref: "ollama/qwen3.6:27b", size_gb: 17 };
  const small = listed("ollama/llama3.2:3b", { tier: "local", size_gb: 2, ctx: 131072, price: { input: 0, output: 0 } });
  const unknown = listed("ollama/mystery", { tier: "local", ctx: 131072, price: { input: 0, output: 0 } });
  const session = { profile: null, provider: "ollama", name: "qwen3.6:27b" };
  assert.equal(row(contextActions(input({ session, models: [own, small, unknown] })), "larger"), undefined);
});

test("larger: a hosted budget model is offered when no local model is a step up", () => {
  const own = { ...OWN, ref: "ollama/qwen3.6:27b", size_gb: 17 };
  const small = listed("ollama/llama3.2:3b", { tier: "local", size_gb: 2, ctx: 131072, price: { input: 0, output: 0 } });
  const session = { profile: null, provider: "ollama", name: "qwen3.6:27b" };
  const rows = contextActions(input({ session, models: [own, small, CHEAP] }));
  assert.equal(row(rows, "larger")?.consequence.startsWith("deepseek-chat"), true);
});

test("larger: a larger local model is preferred over a hosted one", () => {
  const own = { ...OWN, ref: "ollama/qwen3.6:27b", size_gb: 17 };
  const big = listed("ollama/big", { tier: "local", size_gb: 40, ctx: 65536, price: { input: 0, output: 0 } });
  const session = { profile: null, provider: "ollama", name: "qwen3.6:27b" };
  const rows = contextActions(input({ session, models: [own, CHEAP, big] }));
  assert.equal(row(rows, "larger")?.consequence, "big · 64K · free");
});

test("larger: a big prompt costs more a turn, and auto already steps up by itself", () => {
  const dear = listed("openrouter/dear", { tier: "frontier", ctx: 200000, price: { input: 5, output: 20 } });
  const rows = contextActions(input({ models: [OWN, dear], used: 30000 }));
  assert.equal(row(rows, "larger")?.consequence, "dear · 200K · ≈ $0.15 a turn · asks first");
  const auto = contextActions(input({ route: "auto" }));
  assert.equal(row(auto, "larger")?.enabled, false);
  assert.equal(row(auto, "larger")?.why, "the route is auto: golem steps up by itself");
});

test("while an answer is written every row waits", () => {
  const rows = contextActions(input({ busy: true }));
  assert.ok(rows.every((item) => !item.enabled && item.why === "wait for the answer to finish"));
});

test("the suggestion is the first enabled row from 80% full", () => {
  const rows = contextActions(input());
  assert.equal(suggestedAction(rows, 20000, 32768), null);
  assert.equal(suggestedAction(rows, 27000, 32768), "clear");
  const none = contextActions(input({ messages: history(2, 1) }));
  assert.equal(suggestedAction(none, 27000, 32768), "grow");
  assert.equal(suggestedAction(rows, 27000, null), null);
  assert.deepEqual(bestActions(none).map((item) => item.id), ["grow", "larger"]);
});

test("the key row lists the rows that can run, and the keys run them", () => {
  const rows = contextActions(input());
  assert.equal(contextKeyRow(rows), "c clear old results · s summarise · g grow to 64K · m larger model");
  const some = contextActions(input({ messages: history(2, 1), source: "user" }));
  assert.equal(contextKeyRow(some), "m larger model");
  assert.equal(actionForKey(some, "m")?.id, "larger");
  assert.equal(actionForKey(some, "c"), null);
  assert.equal(actionForKey(some, "x"), null);
  assert.equal(contextKeyRow(contextActions(input({ busy: true }))), "");
});

test("the window source is said as the mock does", () => {
  assert.equal(windowSourceLine(32768, "planned"), "32K · planned by golem for this Mac");
  assert.equal(windowSourceLine(8192, "user"), "8K · set by you");
  assert.equal(windowSourceLine(32768, "ollama"), "≈ 32K · Ollama's default");
  assert.equal(windowSourceLine(null, "unknown"), "window unknown");
  assert.equal(windowSourceOf({ window: 32768, planned: true, numCtx: 32768 }), "planned");
  assert.equal(windowSourceOf({ window: 8192, planned: false, numCtx: 8192 }), "user");
  assert.equal(windowSourceOf({ window: 32768, planned: false, numCtx: null }), "ollama");
  assert.equal(windowSourceOf({ window: null, planned: false, numCtx: null }), "unknown");
});

test("the fill line, and the banner only for a cut prompt", () => {
  assert.equal(contextFillLine(18600, 32768, 4096), "18.6K of 32K · reply reserve 4K");
  assert.equal(contextFillLine(18600, 32768, null), "18.6K of 32K");
  assert.equal(contextFillLine(1300, null, null), "1.3K · window unknown");
  assert.equal(cutBanner({ prompt_cut: "yes" }), "The model no longer sees the start of this chat.");
  assert.equal(cutBanner({ prompt_cut: "likely" }) !== null, true);
  assert.equal(cutBanner({ prompt_cut: "no" }), null);
  assert.equal(cutBanner({}), null);
  assert.equal(cutBanner(null), null);
});

test("after a clear the two counting rows wait for the next turn, the others stay", () => {
  const rows = contextActions(input({ changed: true }));
  assert.equal(row(rows, "clear")?.why, "changed just now: the next turn shows what is left");
  assert.equal(row(rows, "summarise")?.enabled, false);
  assert.equal(row(rows, "grow")?.enabled, true);
  assert.equal(row(rows, "larger")?.enabled, true);
});
