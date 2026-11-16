import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoLine,
  contextChart,
  gateLabel,
  parseAmount,
  parsePercent,
  priceTag,
  roomExample,
  routingSummary,
  spansText,
  stageLabels,
  toPercent,
  turnOutcome,
  windowCaption,
  windowSize,
  type RoutingState,
  type Situation,
} from "./routing.ts";

const BASE: RoutingState = {
  mode: "auto",
  paid: "ask",
  over: "local",
  daily: 5,
  chat: null,
  local: "qwen3.8:27b",
  budget: "gpt-6-luna",
  frontier: null,
  budgetCost: "$0.01",
  window: "32K",
};
const state = (patch: Partial<RoutingState>): RoutingState => ({ ...BASE, ...patch });
const say = (situation: Situation, patch: Partial<RoutingState>) => spansText([turnOutcome(situation, state(patch)).sentence]);

test("the window caption names what Auto gives for the model on this Mac", () => {
  assert.equal(windowCaption("ollama/qwen3:27b", 32768, 36), "Auto picks 32K for qwen3:27b on this Mac (36 GB).");
  assert.equal(windowCaption("qwen3:8b", 8192, null), "Auto picks 8K for qwen3:8b on this Mac.");
  assert.equal(windowCaption(null, 8192, 16), null);
  assert.equal(windowCaption("qwen3:8b", null, 16), null);
});

test("a window size reads as a person says it", () => {
  assert.equal(windowSize(32768), "32K");
  assert.equal(windowSize(6144), "6K");
  assert.equal(windowSize(40_000), "40K");
  assert.equal(windowSize(41_500), "41.5K");
  assert.equal(windowSize(900), "900");
});

test("an empty tier says what golem picks", () => {
  assert.equal(autoLine("ollama/qwen3:27b"), "Auto · qwen3:27b");
  assert.equal(autoLine(null), "Auto · nothing is ready");
});

test("a step's price tag is free, about a turn, or paid", () => {
  assert.equal(priceTag("local", null), "free");
  assert.equal(priceTag("budget", null), "paid");
  assert.equal(priceTag("budget", { input: 0, output: 0 }), "free");
  assert.equal(priceTag("budget", { input: 0.3, output: 1.2 }), "< $0.01 a turn");
  assert.equal(priceTag("frontier", { input: 15, output: 75 }), "≈ $0.13 a turn");
});

test("typed amounts: empty clears, junk is refused", () => {
  assert.deepEqual(parseAmount(""), { ok: true, value: null });
  assert.deepEqual(parseAmount(" $2.50 "), { ok: true, value: 2.5 });
  assert.deepEqual(parseAmount("two"), { ok: false, message: "Enter a number." });
});

test("percents convert to shares and back", () => {
  assert.equal(toPercent(0.7), "70");
  assert.equal(toPercent(0.855), "85.5");
  assert.deepEqual(parsePercent("70"), { ok: true, value: 0.7 });
  assert.deepEqual(parsePercent("85.5%"), { ok: true, value: 0.855 });
  assert.deepEqual(parsePercent("x"), { ok: false, message: "Enter a number." });
});

test("the summary of auto names the gate, the steps and the limits", () => {
  const spans = routingSummary(BASE);
  assert.equal(
    spansText(spans),
    "Every turn starts on qwen3.8:27b on this Mac, free. When the prompt does not fit or the model struggles, golem asks you once per chat, then steps up to gpt-6-luna. " +
      "It stops paying at $5.00 a day; then it stays local. No Frontier model is ready, so the path ends at Budget.",
  );
  assert.deepEqual(
    spans[0]?.filter((span) => span.kind !== "text").map((span) => [span.kind, span.text]),
    [["chip", "qwen3.8:27b"], ["free", "free"], ["chip", "gpt-6-luna"]],
  );
  assert.deepEqual(spans[1]?.filter((span) => span.kind === "money").map((span) => span.text), ["$5.00 a day"]);
});

test("the summary of auto with a frontier model, two limits and asking every time", () => {
  const text = spansText(routingSummary(state({ paid: "always_ask", frontier: "claude-opus-5-5", chat: 0.5, over: "ask" })));
  assert.match(text, /golem asks you every time, then steps up to gpt-6-luna\. If that is still not enough, it goes on to claude-opus-5-5\./);
  assert.match(text, /It stops paying at \$5\.00 a day or \$0\.50 a chat; then it asks you\.$/);
  assert.doesNotMatch(text, /No Frontier/);
});

test("the summary of auto with no limit says so", () => {
  assert.match(spansText(routingSummary(state({ daily: null }))), /There is no spending limit\. No Frontier model is ready/);
  assert.match(spansText(routingSummary(state({ daily: null, chat: 2 }))), /It stops paying at \$2\.00 a chat;/);
});

test("the summary of auto with paid never says golem never pays", () => {
  assert.equal(
    spansText(routingSummary(state({ paid: "never" }))),
    "Every turn starts on qwen3.8:27b on this Mac, free, and stays there: golem never pays for a model. " +
      "A prompt that cannot fit even after clearing and summarising stops with a message.",
  );
});

test("the summary of local only and of pinned", () => {
  assert.equal(
    spansText(routingSummary(state({ mode: "local" }))),
    "Every turn runs on qwen3.8:27b on this Mac. Nothing is sent to a hosted provider, and nothing costs money. " +
      "When a chat gets long, golem clears old tool results and summarises earlier turns to stay inside the window.",
  );
  assert.equal(
    spansText(routingSummary(state({ mode: "pinned", daily: null }))),
    "Each chat stays on the one model you pick for it. golem never switches models by itself. " +
      "A pinned hosted model is paid without a question. There is no spending limit.",
  );
  assert.match(spansText(routingSummary(state({ mode: "pinned", chat: 1 }))), /It stops paying at \$5\.00 a day or \$1\.00 a chat; then it stays local\.$/);
});

test("the summary names a model that is not ready", () => {
  assert.match(spansText(routingSummary(state({ local: null }))), /^Every turn starts on a local model on this Mac/);
});

test("the gate says what it does for each route and choice", () => {
  assert.equal(gateLabel({ mode: "auto", paid: "ask" }), "asks once");
  assert.equal(gateLabel({ mode: "auto", paid: "always_ask" }), "asks every time");
  assert.equal(gateLabel({ mode: "auto", paid: "never" }), "closed");
  assert.equal(gateLabel({ mode: "local", paid: "ask" }), "closed · local only");
  assert.equal(gateLabel({ mode: "pinned", paid: "never" }), "not used");
});

const ASK_STEPS = [
  { part: "local", state: "pass" },
  { part: "gate", state: "ask" },
  { part: "budget", state: "hit" },
];
const STAY_STEPS = [
  { part: "local", state: "hit" },
  { part: "gate", state: "stop" },
];

test("a quick question stays on the local model unless the route is pinned", () => {
  for (const patch of [{}, { paid: "always_ask" as const }, { paid: "never" as const }, { mode: "local" as const }]) {
    const out = turnOutcome("quick", state(patch));
    assert.deepEqual(out.parts, [{ part: "local", state: "hit" }]);
    assert.equal(out.mark, "ok");
    assert.equal(spansText([out.sentence]), "qwen3.8:27b answers on this Mac. Free. The gate is never reached.");
  }
  const pinned = turnOutcome("quick", state({ mode: "pinned" }));
  assert.deepEqual(pinned.parts, []);
  assert.equal(spansText([pinned.sentence]), "Pinned: the turn runs on the chat's own model. golem does not switch.");
});

test("a prompt too big asks and steps up to Budget, or stops", () => {
  const once = turnOutcome("too_big", BASE);
  assert.deepEqual(once.parts, ASK_STEPS);
  assert.equal(once.mark, "pays");
  assert.equal(
    spansText([once.sentence]),
    "First golem clears old tool results and summarises, which is free. Still too big: it asks once (allow for this chat, only this turn, or stay local). After a yes, gpt-6-luna answers for about $0.01.",
  );
  assert.match(say("too_big", { paid: "always_ask" }), /it asks this time too \(/);
  assert.match(say("too_big", { budgetCost: null }), /gpt-6-luna answers\.$/);
  const never = turnOutcome("too_big", state({ paid: "never" }));
  assert.deepEqual(never.parts, STAY_STEPS);
  assert.equal(never.mark, "stops");
  assert.equal(spansText([never.sentence]), "golem clears old tool results and summarises. If the prompt still cannot fit, the turn stops with a message. Nothing is paid.");
  const local = turnOutcome("too_big", state({ mode: "local" }));
  assert.deepEqual(local.parts, STAY_STEPS);
  assert.equal(local.mark, "ok");
  assert.match(spansText([local.sentence]), /^The route is local only: qwen3\.8:27b answers, and golem never asks about paying\. If a prompt cannot fit, golem clears and summarises; then the turn stops and says why\.$/);
  assert.match(say("too_big", { mode: "pinned" }), /^Pinned: .* If the prompt cannot fit after clearing and summarising, the turn stops and says why\.$/);
});

test("a struggling local model: with ask the run may move once, with always ask it finishes local", () => {
  const ask = turnOutcome("struggles", BASE);
  assert.deepEqual(ask.parts, ASK_STEPS);
  assert.equal(ask.mark, "pays");
  assert.equal(
    spansText([ask.sentence]),
    "If you already said yes in this chat, the run moves to gpt-6-luna once and goes on. Without a yes it finishes on qwen3.8:27b, because golem does not stop a run to ask.",
  );
  const every = turnOutcome("struggles", state({ paid: "always_ask" }));
  assert.deepEqual(every.parts, STAY_STEPS);
  assert.equal(
    spansText([every.sentence]),
    'golem cannot stop to ask in the middle of a run, and "ask every time" remembers no yes. The run finishes on qwen3.8:27b.',
  );
  assert.equal(say("struggles", { paid: "never" }), "The gate is closed, so the turn stays on qwen3.8:27b. Nothing is paid.");
  assert.match(say("struggles", { mode: "local" }), /^The route is local only: /);
  assert.match(say("struggles", { mode: "pinned" }), /^Pinned: the turn runs on the chat's own model\. golem does not switch\.$/);
});

test("a spent limit: no limit, stay local, or ask", () => {
  const none = turnOutcome("limit_spent", state({ daily: null }));
  assert.deepEqual(none.parts, []);
  assert.equal(spansText([none.sentence]), "No limit is set, so this cannot happen. Set one in the paid gate below.");
  const local = turnOutcome("limit_spent", BASE);
  assert.deepEqual(local.parts, STAY_STEPS);
  assert.equal(spansText([local.sentence]), "The limit is reached, so the turn stays on qwen3.8:27b. A line in the chat says so.");
  const ask = turnOutcome("limit_spent", state({ over: "ask" }));
  assert.deepEqual(ask.parts, ASK_STEPS);
  assert.equal(ask.mark, "pays");
  assert.equal(spansText([ask.sentence]), "The limit is reached, so golem asks before it pays more. After a yes, gpt-6-luna answers.");
  assert.equal(say("limit_spent", { paid: "never", over: "ask" }), "The gate is closed, so the turn stays on qwen3.8:27b. Nothing is paid.");
  assert.match(say("limit_spent", { mode: "local" }), /^The route is local only: /);
  assert.match(say("limit_spent", { mode: "pinned" }), /^Pinned: /);
  assert.equal(say("limit_spent", { chat: 1, daily: null, over: "ask" }).startsWith("The limit is reached, so golem asks"), true);
});

test("a chat in a local-only folder never reaches the gate, whatever the route", () => {
  for (const patch of [{}, { paid: "always_ask" as const }, { paid: "never" as const }, { mode: "local" as const }]) {
    const out = turnOutcome("local_only_folder", state(patch));
    assert.deepEqual(out.parts, STAY_STEPS);
    assert.equal(out.mark, "ok");
    assert.match(spansText([out.sentence]), /^The folder is local only: qwen3\.8:27b answers, and golem never asks about paying\./);
  }
  assert.match(say("local_only_folder", { mode: "pinned" }), /^Pinned: /);
});

test("a chart keeps its line under the reply band for the allowed settings", () => {
  const shares: [number, number, number][] = [
    [0.4, 0.7, 0.85],
    [0.05, 0.1, 0.2],
    [0.5, 0.6, 0.99],
    [0.01, 0.02, 0.03],
    [0.8, 0.9, 0.95],
  ];
  for (const window of [512, 8192, 32768, 262144]) {
    for (const reserve of [0, 1024, 4096, Math.floor(window / 2), window]) {
      for (const [to, at, sum] of shares) {
        const chart = contextChart({ reply_reserve: reserve, clear_to: to, clear_at: at, compact_at: sum }, window);
        assert.ok(chart !== null);
        const ceiling = 100 - chart.reply;
        for (const point of chart.line) {
          assert.ok(point.pct <= ceiling + 1e-9, `${window} ${reserve} ${to} ${at} ${sum}: ${point.pct} > ${ceiling}`);
          assert.ok(point.pct >= 0);
          assert.ok(point.x >= 0 && point.x <= 1 + 1e-9);
        }
        assert.ok(chart.clearAt <= chart.compactAt && chart.compactAt <= ceiling);
        const xs = chart.line.map((point) => point.x);
        assert.deepEqual([...xs].sort((a, b) => a - b), xs);
      }
    }
  }
});

test("a chart has three clears, one that frees little, then a summary", () => {
  const chart = contextChart({ reply_reserve: 4096, clear_to: 0.4, clear_at: 0.7, compact_at: 0.85 }, 32768);
  assert.ok(chart !== null);
  assert.deepEqual(chart.marks.map((mark) => mark.kind), ["clear", "clear", "clear", "summary", "clear"]);
  assert.equal(chart.reply, 12.5);
  assert.equal(chart.clearAt, 70 * 0.875);
  assert.equal(chart.compactAt, 85 * 0.875);
  assert.equal(contextChart({ reply_reserve: 4096, clear_to: 0.4, clear_at: 0.7, compact_at: 0.85 }, null), null);
});

test("the worked example and the stage labels use the settings", () => {
  assert.match(roomExample(32768, 4096), /With a 32K window and 4K kept, the chat may use 28K\. The percentages below count against those 28K\.$/);
  assert.equal(roomExample(null, 4096).includes("With a"), false);
  assert.deepEqual(stageLabels({ clear_at: 0.7, compact_at: 0.85 }), {
    always: "always",
    one: "step 1 · at 70% full · free",
    two: "step 2 · at 85% full · one model call",
  });
});
