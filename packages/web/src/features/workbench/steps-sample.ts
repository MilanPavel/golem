import { emptyChat, reduceChat, type ChatState } from "@golem/view";

type ChatEvent = Parameters<typeof reduceChat>[1];

/** Fixtures of a lead whose batch of helpers ran over time, for the Steps tab: the gallery and the tests. */

const base = { session_id: "s", run_id: "r" } as const;
const T0 = Date.parse("2026-11-20T10:00:00.000Z");
/** The time in the fixtures that is "now" while a batch still runs: 60 s after the call. */
export const STEPS_NOW = T0 + 60_000;

let seq = 0;
const next = (): number => (seq += 1);
const at = (sec: number): string => new Date(T0 + sec * 1000).toISOString();

function lead(): ChatEvent[] {
  return [
    { ...base, ts: at(0), seq: next(), type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, ts: at(0), seq: next(), type: "message.completed", data: { message_id: "a", role: "assistant", text: "I sent helpers to read the code." } },
    { ...base, ts: at(0), seq: next(), type: "tool.requested", data: { call_id: "d1", message_id: "a", name: "delegate", args: { brief: "read the auth code" } } },
  ];
}

function started(sec: number, index: number, agent: string, model: string): ChatEvent {
  return { ...base, ts: at(sec), seq: next(), type: "helper.started", data: { call_id: "d1", index, helper_id: `h${String(index + 1)}`, agent, label: agent, model, wish: "read", pick_reason: "" } };
}

function state(sec: number, index: number, value: "queued" | "running" | "waiting", reason?: string): ChatEvent {
  return { ...base, ts: at(sec), seq: next(), type: "helper.state", data: { call_id: "d1", index, state: value, ...(reason === undefined ? {} : { reason }) } };
}

function ended(sec: number, index: number, cost: number, durationMs: number): ChatEvent {
  return { ...base, ts: at(sec), seq: next(), type: "helper.ended", data: { call_id: "d1", index, stopped: "done", model_calls: 3, tokens: 14000, answer_tokens: 600, cost_usd: cost, duration_ms: durationMs, working_ms: durationMs } };
}

function chatOf(events: ChatEvent[]): ChatState {
  seq = 0;
  return events.reduce(reduceChat, emptyChat);
}

/** Local models only, all done: the helpers take turns, so the later ones wait in line (hatched) first. */
export function localFinishedChat(): ChatState {
  return chatOf([
    ...lead(),
    started(0, 0, "explorer", "ollama/qwen3:27b"),
    state(0, 0, "running"),
    started(0, 1, "docs", "ollama/qwen3:27b"),
    state(0, 1, "queued", "slot"),
    started(0, 2, "tests", "ollama/qwen3:27b"),
    state(0, 2, "queued", "slot"),
    ended(20, 0, 0, 20_000),
    state(20, 1, "running"),
    ended(35, 1, 0, 35_000),
    state(35, 2, "running"),
    ended(50, 2, 0, 50_000),
  ]);
}

/** Local models only, still running at `STEPS_NOW`: one done, one works, one waits in line. */
export function localRunningChat(): ChatState {
  return chatOf([
    ...lead(),
    started(0, 0, "explorer", "ollama/qwen3:27b"),
    state(0, 0, "running"),
    started(0, 1, "docs", "ollama/qwen3:27b"),
    state(0, 1, "queued", "slot"),
    started(0, 2, "tests", "ollama/qwen3:27b"),
    state(0, 2, "queued", "slot"),
    ended(20, 0, 0, 20_000),
    state(20, 1, "running"),
  ]);
}

/** Cloud models only, all done: the helpers overlap and none waits in line. One waited for you. */
export function cloudFinishedChat(): ChatState {
  return chatOf([
    ...lead(),
    started(0, 0, "explorer", "anthropic/claude-haiku"),
    state(0, 0, "running"),
    started(0, 1, "docs", "anthropic/claude-haiku"),
    state(0, 1, "running"),
    state(10, 1, "waiting", "you"),
    state(18, 1, "running"),
    ended(20, 0, 0.04, 20_000),
    ended(30, 1, 0.03, 30_000),
  ]);
}

/** Cloud models only, still running at `STEPS_NOW`. */
export function cloudRunningChat(): ChatState {
  return chatOf([
    ...lead(),
    started(0, 0, "explorer", "anthropic/claude-haiku"),
    state(0, 0, "running"),
    started(2, 1, "docs", "anthropic/claude-haiku"),
    state(2, 1, "running"),
    ended(20, 0, 0.04, 20_000),
  ]);
}
