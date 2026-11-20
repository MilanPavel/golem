import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";
import { emptyChat, foldBatch, reduceChat, type HelperBatch, type HelperRef } from "@golem/view";

import type { Span } from "./layout-chat.ts";
import {
  barSpans,
  batchOrder,
  breadcrumb,
  closedStepsManager,
  layoutStepsManager,
  openStepsManager,
  pressStepsManager,
  stepsHelpers,
  stepsKeyOf,
  type StepsContext,
  type StepsManagerState,
} from "./steps-view.ts";

const T0 = Date.parse("2026-01-01T00:00:00Z");
let seq = 0;

function ev(s: number, type: string, data: Record<string, unknown>, session = "lead"): ChatEvent {
  seq += 1;
  return { seq, session_id: session, run_id: "r1", ts: new Date(T0 + s * 1000).toISOString(), type, data } as unknown as ChatEvent;
}

const started = (s: number, index: number, label: string): ChatEvent =>
  ev(s, "helper.started", { call_id: "d1", index, helper_id: `h${String(index)}`, agent: "explorer", label, model: "m", wish: "cheapest", pick_reason: "" });
const state = (s: number, index: number, st: string, reason?: string): ChatEvent =>
  ev(s, "helper.state", { call_id: "d1", index, state: st, ...(reason === undefined ? {} : { reason }) });
const ended = (s: number, index: number, ms: number): ChatEvent =>
  ev(s, "helper.ended", { call_id: "d1", index, stopped: "done", model_calls: 1, tokens: 1000, answer_tokens: 100, cost_usd: 0, duration_ms: ms, working_ms: ms });

const text = (spans: readonly Span[]): string => spans.map((span) => span.text).join("");
const now = T0 + 40_000;

/** Cloud only: three helpers overlap. */
const cloud: ChatEvent[] = [
  started(0, 0, "auth"),
  state(0, 0, "running"),
  started(0, 1, "billing"),
  state(0, 1, "running"),
  started(0, 2, "docs"),
  state(0, 2, "running"),
  ended(10, 0, 10_000),
  ended(20, 1, 20_000),
];

/** Local only: they take turns, so later ones start in line. */
const local: ChatEvent[] = [
  started(0, 0, "auth"),
  state(0, 0, "running"),
  started(0, 1, "billing"),
  started(0, 2, "docs"),
  ended(10, 0, 10_000),
  state(10, 1, "running"),
  ended(20, 1, 10_000),
  state(20, 2, "waiting", "you"),
  state(30, 2, "running"),
];

function batchOf(events: ChatEvent[]): Record<string, HelperBatch> {
  return { d1: foldBatch("d1", events) };
}

test("a bar has a fixed width and one character per kind", () => {
  const bar = barSpans(
    {
      from: 0,
      to: 1,
      segments: [
        { kind: "line", from: 0, to: 0.25 },
        { kind: "work", from: 0.25, to: 0.75 },
        { kind: "you", from: 0.75, to: 1 },
      ],
    },
    8,
  );
  assert.equal(text(bar), "░░████▓▓");
  assert.equal(bar[0]?.dim, true);
  assert.equal(bar[1]?.dim, undefined);
  assert.equal(bar[2]?.warn, true);
});

test("a bar is blank outside its row and a very short row still shows one cell", () => {
  const bar = barSpans({ from: 0.5, to: 0.5, segments: [] }, 10);
  assert.equal(text(bar), "     █    ");
  assert.equal([...text(bar)].length, 10);
  const tail = barSpans({ from: 0.5, to: 1, segments: [{ kind: "work", from: 0.5, to: 1 }] }, 10);
  assert.equal(text(tail), "     █████");
});

test("batches are listed newest first", () => {
  const order = batchOrder({ a: foldBatch("a", []), b: foldBatch("b", []), c: foldBatch("c", []) });
  assert.deepEqual(order, ["c", "b", "a"]);
});

test("keys: x stops, tab switches, enter and esc go in and out", () => {
  assert.equal(stepsKeyOf({ name: null, input: "x", ctrl: false, meta: false }), "stop");
  assert.equal(stepsKeyOf({ name: "tab", input: "", ctrl: false, meta: false }), "mode");
  assert.equal(stepsKeyOf({ name: "return", input: "", ctrl: false, meta: false }), "enter");
  assert.equal(stepsKeyOf({ name: null, input: "y", ctrl: false, meta: false }), null);
});

function context(events: ChatEvent[], chatMax = 5): StepsContext {
  return { order: ["d1"], helpers: (callId) => stepsHelpers(callId, events, now), chatMax };
}

test("the list opens Steps, Steps opens a helper's chat, Esc walks back", () => {
  const ctx = context(cloud);
  let step = pressStepsManager(openStepsManager(), ctx, "enter");
  assert.deepEqual(step.state.view, { kind: "steps", callId: "d1", selected: 0, fromList: true });
  step = pressStepsManager(step.state, ctx, "down");
  const second = step.state.view;
  assert.equal(second.kind === "steps" ? second.selected : -1, 1);
  step = pressStepsManager(step.state, ctx, "enter");
  assert.deepEqual(step.action, { kind: "open-chat", callId: "d1", index: 1 });
  assert.equal(step.state.view.kind, "chat");
  step = pressStepsManager(step.state, ctx, "back");
  assert.deepEqual(step.action, { kind: "leave-chat", callId: "d1", index: 1 });
  assert.deepEqual(step.state.view, { kind: "steps", callId: "d1", selected: 1, fromList: true });
  step = pressStepsManager(step.state, ctx, "back");
  assert.deepEqual(step.state.view, { kind: "list", selected: 0 });
  step = pressStepsManager(step.state, ctx, "back");
  assert.deepEqual(step.action, { kind: "close" });
  assert.equal(step.state.open, false);
});

test("Esc on Steps opened with Enter on the composer closes the screen", () => {
  const ctx = context(cloud);
  const out = pressStepsManager(openStepsManager("d1"), ctx, "back");
  assert.deepEqual(out.action, { kind: "close" });
  assert.deepEqual(out.state, closedStepsManager);
});

test("x stops a helper that runs and does nothing for one that ended", () => {
  const ctx = context(cloud);
  const open = (selected: number): StepsManagerState => ({ open: true, view: { kind: "steps", callId: "d1", selected, fromList: false } });
  // Rows in start order at equal starts: auth, billing, docs. auth ended, docs runs.
  assert.deepEqual(pressStepsManager(open(0), ctx, "stop").action, { kind: "none" });
  assert.deepEqual(pressStepsManager(open(2), ctx, "stop").action, { kind: "stop", callId: "d1", index: 2 });
  const inChat: StepsManagerState = { open: true, view: { kind: "chat", callId: "d1", index: 2, mode: "summary", offset: 0, fromList: false } };
  assert.deepEqual(pressStepsManager(inChat, ctx, "stop").action, { kind: "stop", callId: "d1", index: 2 });
});

test("in a chat, tab switches the view and the arrows scroll within the limit", () => {
  const ctx = context(cloud, 3);
  const chat: StepsManagerState = { open: true, view: { kind: "chat", callId: "d1", index: 0, mode: "summary", offset: 0, fromList: false } };
  const tab = pressStepsManager(chat, ctx, "mode");
  assert.equal(tab.state.view.kind === "chat" ? tab.state.view.mode : "", "everything");
  let down = tab.state;
  for (let i = 0; i < 10; i += 1) down = pressStepsManager(down, ctx, "down").state;
  assert.equal(down.view.kind === "chat" ? down.view.offset : -1, 3);
  const up = pressStepsManager(down, ctx, "page-up").state;
  assert.equal(up.view.kind === "chat" ? up.view.offset : -1, 0);
});

const layout = (events: ChatEvent[], view: StepsManagerState, helper = null as Parameters<typeof layoutStepsManager>[0]["helper"], refs: HelperRef[] = []) =>
  layoutStepsManager({
    state: view,
    batches: batchOf(events),
    events,
    refs: () => refs,
    helper,
    lead: "Fix the login bug",
    now,
    columns: 80,
    rows: 20,
  }).map((line) => text(line.spans));

test("the list names the batch and how it stands", () => {
  const rows = layout(cloud, openStepsManager());
  assert.equal(rows[0], "Steps");
  assert.match(rows[1] ?? "", /1 run of helpers, newest first/);
  assert.match(rows[3] ?? "", /^❯ /);
  assert.match(rows[3] ?? "", /helper/);
  assert.match(rows.at(-1) ?? "", /Esc close/);
});

test("cloud only: Steps shows overlapping bars, no waiting in line", () => {
  const rows = layout(cloud, openStepsManager("d1"));
  const bars = rows.filter((row) => /[█░▓]/.test(row));
  assert.ok(bars.length >= 4);
  const helperRows = rows.filter((row) => /auth|billing|docs/.test(row) && /[█░]/.test(row));
  assert.equal(helperRows.length, 3);
  assert.ok(helperRows.every((row) => !row.includes("░")));
  assert.ok(rows.every((row) => [...row].length <= 80));
  assert.match(rows.find((row) => row.includes("auth")) ?? "", /^❯ /);
  assert.match(rows.at(-1) ?? "", /x stops it/);
});

test("local only: later helpers wait in line, and one waits for you", () => {
  const rows = layout(local, openStepsManager("d1"));
  const billing = rows.find((row) => row.includes("billing")) ?? "";
  const docs = rows.find((row) => row.includes("docs")) ?? "";
  assert.ok(billing.includes("░"));
  assert.ok(billing.includes("█"));
  assert.ok(docs.includes("▓"));
  assert.ok(rows.some((row) => row.includes("waiting for you")));
});

const ref: HelperRef = { id: "h1", index: 1, agent: "explorer", label: "billing", model: "m", startedAt: new Date(T0).toISOString(), ended: null };

test("a helper's chat is read-only with a breadcrumb, Summary first, then Everything", () => {
  let chat = emptyChat;
  chat = reduceChat(chat, ev(0, "message.completed", { message_id: "u1", role: "user", text: "Find the billing bug." }, "h1"));
  chat = reduceChat(chat, ev(1, "message.completed", { message_id: "a1", role: "assistant", text: "It is in invoice.py." }, "h1"));
  const data = { sessionId: "h1", chat, error: null };
  const view = (mode: "summary" | "everything"): StepsManagerState => ({
    open: true,
    view: { kind: "chat", callId: "d1", index: 1, mode, offset: 0, fromList: false },
  });
  const summary = layout(cloud, view("summary"), data, [ref]);
  assert.equal(summary[0], "Fix the login bug › explorer · billing");
  assert.match(summary[1] ?? "", /read-only · Summary/);
  assert.ok(summary.some((row) => row === "Asked"));
  assert.ok(summary.some((row) => row.includes("Find the billing bug.")));
  assert.ok(summary.some((row) => row.includes("It is in invoice.py.")));
  assert.match(summary.at(-1) ?? "", /Esc back/);
  assert.ok(!summary.some((row) => /Enter send|Type a message/.test(row)));
  const everything = layout(cloud, view("everything"), data, [ref]);
  assert.match(everything[1] ?? "", /read-only · Everything/);
  assert.ok(everything.some((row) => row.includes("It is in invoice.py.")));
});

test("a helper's chat says when it is not there yet, or could not be read", () => {
  const open: StepsManagerState = { open: true, view: { kind: "chat", callId: "d1", index: 1, mode: "summary", offset: 0, fromList: false } };
  assert.ok(layout(cloud, open, null, [ref]).includes("asking the daemon…"));
  const failed = layout(cloud, open, { sessionId: "h1", chat: emptyChat, error: "Could not open this helper: gone" }, [ref]);
  assert.ok(failed.includes("Could not open this helper: gone"));
});

test("breadcrumb falls back when the label is the agent or the lead has no title", () => {
  assert.equal(breadcrumb("", { agent: "explorer", label: "explorer" }), "this chat › explorer");
});
