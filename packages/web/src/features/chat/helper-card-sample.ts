import { emptyChat, reduceChat, type ChatState, type IsLocal } from "@golem/view";

type ChatEvent = Parameters<typeof reduceChat>[1];

/** Fixtures of a lead that sent a batch of helpers, folded the way the page folds its log. For the gallery and the tests. */

const base = { session_id: "s", run_id: "r" } as const;
const T = "2026-11-20T10:00:00.000Z";
let seq = 0;
const next = (): number => (seq += 1);

function lead(): ChatEvent[] {
  return [
    { ...base, ts: T, seq: next(), type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, ts: T, seq: next(), type: "message.completed", data: { message_id: "a", role: "assistant", text: "I sent three helpers to read the code." } },
    { ...base, ts: T, seq: next(), type: "tool.requested", data: { call_id: "d1", message_id: "a", name: "delegate", args: { brief: "read the auth code" } } },
  ];
}

function started(index: number, agent: string, model: string, pick = ""): ChatEvent {
  return { ...base, ts: T, seq: next(), type: "helper.started", data: { call_id: "d1", index, helper_id: `h${String(index + 1)}`, agent, label: agent, model, wish: "read", pick_reason: pick } };
}

function state(index: number, value: "queued" | "running" | "waiting", reason?: string): ChatEvent {
  return { ...base, ts: T, seq: next(), type: "helper.state", data: { call_id: "d1", index, state: value, ...(reason === undefined ? {} : { reason }) } };
}

function step(index: number, id: string, name: string, done: boolean): ChatEvent {
  return { ...base, ts: T, seq: next(), type: "helper.step", data: { call_id: "d1", index, step_id: id, name, args: { path: "a.py" }, status: done ? "done" : "running", calls: 1, ...(done ? { summary: "3 lines" } : {}) } };
}

function ended(index: number, cost: number): ChatEvent {
  return { ...base, ts: T, seq: next(), type: "helper.ended", data: { call_id: "d1", index, stopped: "done", model_calls: 3, tokens: 14000, answer_tokens: 600, cost_usd: cost, duration_ms: 71000, working_ms: 70000 } };
}

function chatOf(events: ChatEvent[]): ChatState {
  seq = 0;
  return events.reduce(reduceChat, emptyChat);
}

/** Three helpers on local models: one done, one running, one queued behind a slot. */
export function localBatchChat(): ChatState {
  return chatOf([
    ...lead(),
    started(0, "explorer", "ollama/qwen3:27b", "fits your machine"),
    state(0, "running"),
    step(0, "k1", "read_file", true),
    ended(0, 0),
    started(1, "docs", "ollama/qwen3:27b", "fits your machine"),
    state(1, "running"),
    step(1, "k2", "read_file", false),
    started(2, "tests", "ollama/qwen3:27b", "fits your machine"),
    state(2, "queued", "slot"),
  ]);
}

/** Two helpers on cloud models, both done: the numbers show cost first. */
export function cloudBatchChat(): ChatState {
  return chatOf([
    ...lead(),
    started(0, "explorer", "anthropic/claude-haiku", "cheapest that reads well"),
    state(0, "running"),
    step(0, "k1", "read_file", true),
    ended(0, 0.04),
    started(1, "docs", "anthropic/claude-haiku", "cheapest that reads well"),
    state(1, "running"),
    ended(1, 0.03),
  ]);
}

/** One helper asks you for a go-ahead while another runs. */
export function askingBatchChat(): ChatState {
  return chatOf([
    ...lead(),
    started(0, "explorer", "ollama/qwen3:27b"),
    state(0, "running"),
    step(0, "k1", "read_file", true),
    started(1, "writer", "ollama/qwen3:27b"),
    state(1, "waiting", "you"),
  ]);
}

export const ALL_LOCAL: IsLocal = () => true;
export const ALL_CLOUD: IsLocal = () => false;
