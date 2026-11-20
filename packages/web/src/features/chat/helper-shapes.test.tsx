import { emptyChat, reduceChat, type ToolBlock } from "@golem/view";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ToolLine } from "./transcript.tsx";

type ChatEvent = Parameters<typeof reduceChat>[1];

afterEach(cleanup);

// The same helper story in the old shape (child run, events with parent_call_id) and in the new
// shape (helper.* events of a child session). Fixtures mirror packages/view/src/chat-state.test.ts.
const base = { session_id: "s", run_id: "r" } as const;
const T = "2026-11-01T10:00:02.000Z";

const lead = (): ChatEvent[] => [
  { ...base, ts: T, seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } },
  { ...base, ts: T, seq: 2, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
  { ...base, ts: T, seq: 3, type: "tool.requested", data: { call_id: "d1", message_id: "a", name: "delegate", args: { brief: "look d1" } } },
];

const oldRead = (call: string, path: string, seq: number, finish: boolean, summary = "3 lines"): ChatEvent[] => {
  const p = { parent_call_id: "d1" };
  const opened: ChatEvent[] = [
    { ...base, ts: T, seq, type: "tool.requested", data: { call_id: call, message_id: "m", name: "read_file", args: { path }, ...p } },
    { ...base, ts: T, seq: seq + 1, type: "tool.started", data: { call_id: call, ...p } },
  ];
  const closed: ChatEvent[] = [{ ...base, ts: T, seq: seq + 2, type: "tool.completed", data: { call_id: call, summary, preview: "x", ...p } }];
  return finish ? [...opened, ...closed] : opened;
};
const oldCall = (seq: number, usage: { input: number; output: number }, cost: number): ChatEvent[] => {
  const p = { parent_call_id: "d1" };
  return [
    { ...base, ts: T, seq, type: "model.call.started", data: { message_id: `m${String(seq)}`, index: 1, profile: "p", model: "qwen3:27b", tier: "local", ...p } },
    { ...base, ts: T, seq: seq + 1, type: "model.call.completed", data: { message_id: `m${String(seq)}`, latency_ms: 10, usage, cost_usd: cost, ...p } },
  ];
};
const newStep = (seq: number, id: string, path: string, status: "running" | "done", summary?: string): ChatEvent => ({
  ...base, ts: T, seq, type: "helper.step",
  data: { call_id: "d1", index: 0, step_id: id, name: "read_file", args: { path }, status, calls: 1, ...(summary === undefined ? {} : { summary }) },
});
const newStart: ChatEvent = {
  ...base, ts: T, seq: 10, type: "helper.started",
  data: { call_id: "d1", index: 0, helper_id: "h1", agent: "explorer", label: "explorer", model: "qwen3:27b", wish: "same", pick_reason: "" },
};
const newRunning: ChatEvent = { ...base, ts: T, seq: 11, type: "helper.state", data: { call_id: "d1", index: 0, state: "running" } };
const newEnd: ChatEvent = {
  ...base, ts: T, seq: 16, type: "helper.ended",
  data: { call_id: "d1", index: 0, stopped: "done", model_calls: 2, tokens: 1040, answer_tokens: 620, cost_usd: 0.5, duration_ms: 71000, working_ms: 70000 },
};
const delegateEnd: ChatEvent = {
  ...base, ts: "2026-11-01T10:01:13.000Z", seq: 40, type: "tool.completed",
  data: { call_id: "d1", summary: "explorer finished", preview: "found it", duration_ms: 71000 },
};

const delegateOf = (events: ChatEvent[]): ToolBlock => {
  const tool = events.reduce(reduceChat, emptyChat).messages[0]?.tools?.[0];
  if (!tool) throw new Error("no delegate step");
  return tool;
};

/** The helper card as the page draws it: closed, then opened. */
function cards(tool: ToolBlock): string[] {
  const out: string[] = [];
  const { container } = render(<ul><ToolLine tool={tool} /></ul>);
  // useId counts up across renders, so the ids differ between two cards that are the same.
  const html = () => container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_id_");
  out.push(html());
  fireEvent.click(screen.getAllByRole("button")[0]!);
  out.push(html());
  cleanup();
  return out;
}

test("a running helper draws the same card in the old and the new log shape", () => {
  const old = delegateOf([...lead(), ...oldCall(10, { input: 100, output: 20 }, 0), ...oldRead("k1", "a.py", 12, true), ...oldRead("k2", "b.py", 15, false)]);
  const now = delegateOf([...lead(), newStart, newRunning, newStep(12, "k1", "a.py", "running"), newStep(13, "k1", "a.py", "done", "3 lines"), newStep(14, "k2", "b.py", "running")]);
  expect(old.child?.status).toBe("running");
  expect(now.child?.status).toBe("running");
  expect(cards(now)).toEqual(cards(old));
});

test("a done helper draws the same card in the old and the new log shape", () => {
  const old = delegateOf([
    ...lead(),
    ...oldCall(10, { input: 100, output: 20 }, 0),
    ...oldRead("k1", "a.py", 12, true),
    ...oldRead("k2", "b.py", 15, true),
    ...oldCall(20, { input: 300, output: 620 }, 0.5),
    delegateEnd,
  ]);
  const now = delegateOf([
    ...lead(), newStart, newRunning,
    newStep(12, "k1", "a.py", "running"), newStep(13, "k1", "a.py", "done", "3 lines"),
    newStep(14, "k2", "b.py", "running"), newStep(15, "k2", "b.py", "done", "3 lines"),
    newEnd, delegateEnd,
  ]);
  expect(old.child?.status).toBe("done");
  expect(now.child?.status).toBe("done");
  expect(cards(now)).toEqual(cards(old));
});

// A finished step shows its one-line summary ("3 lines") in both shapes. An older log has no
// summary on helper.step: the step then says "done".
test("a finished step shows its summary in both shapes", () => {
  const old = delegateOf([...lead(), ...oldRead("k1", "a.py", 12, true, "3 lines")]);
  const now = delegateOf([...lead(), newStart, newStep(13, "k1", "a.py", "done", "3 lines")]);
  expect(cards(old)[1]).toContain("3 lines");
  expect(cards(now)[1]).toContain("3 lines");
});

test("a step of an older log with no summary still shows done", () => {
  const now = delegateOf([...lead(), newStart, newStep(13, "k1", "a.py", "done")]);
  const open = cards(now)[1];
  expect(open).toContain("done");
  expect(open).not.toContain("3 lines");
});
