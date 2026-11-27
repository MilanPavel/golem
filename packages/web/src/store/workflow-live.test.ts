import type { WorkflowNotice, WorkflowStatusResult } from "@golem/client";
import { expect, test } from "vitest";
import { foldWorkflowNotice, liveStatusKey } from "./workflow-live.ts";
import { workflowStatusKey } from "./workflows.ts";

const status = (extra: Partial<WorkflowStatusResult> = {}): WorkflowStatusResult => ({
  run: { workflow_run_id: "wr_1", workflow_id: "/w.py::flow", name: "flow", status: "running", trigger: "manual", inputs: {}, steps_expected: 3, outputs: [] },
  steps: [{ key: "a", kind: "step", title: "A", status: "running", attempts: 1 }],
  reviews: [],
  ...extra,
});

const step = (method: string, params: Record<string, unknown>): WorkflowNotice => ({ kind: "step", method, params: { workflow_run_id: "wr_1", key: "a", kind: "step", title: "A", status: "done", attempts: 1, ...params } as never });

test("the live key is the key of workflow.status", () => {
  expect(liveStatusKey("wr_1")).toEqual(workflowStatusKey("wr_1"));
});

test("a step event is folded in by key, with its line and total, and adds a step it has not seen", () => {
  const done = foldWorkflowNotice(status(), step("workflow.step.done", { result: "x", line: "x", of: 30, result_size: 3 }))!;
  expect(done.stale).toBe(false);
  expect(done.status.steps).toHaveLength(1);
  expect(done.status.steps![0]).toMatchObject({ key: "a", status: "done", line: "x", of: 30 });
  expect("result_size" in done.status.steps![0]!).toBe(false);
  expect("workflow_run_id" in done.status.steps![0]!).toBe(false);
  const added = foldWorkflowNotice(done.status, step("workflow.step.started", { key: "b", status: "running" }))!;
  expect(added.status.steps!.map((one) => one.key)).toEqual(["a", "b"]);
});

test("an event for another run changes nothing", () => {
  expect(foldWorkflowNotice(status(), { ...step("workflow.step.done", {}), params: { workflow_run_id: "wr_2", key: "a", status: "done" } } as never)).toBeNull();
});

test("a result that was left out of an event, and a step that waits, ask for one more read", () => {
  expect(foldWorkflowNotice(status(), step("workflow.step.done", { result: null, result_size: 6000, line: "…" }))!.stale).toBe(true);
  expect(foldWorkflowNotice(status(), step("workflow.step.waiting", { status: "waiting" }))!.stale).toBe(true);
  const asked = status({ reviews: [{ key: "r", ask: "Send?", created_at: "2026-11-27T08:00:00Z", answered: false } as never] });
  expect(foldWorkflowNotice(asked, step("workflow.step.done", {}))!.stale).toBe(true);
});

test("a run event moves the state and the total; done brings the result and the summary", () => {
  const run = (method: string, params: Record<string, unknown>): WorkflowNotice => ({ kind: "run", method, params: { workflow_run_id: "wr_1", workflow_id: "/w.py::flow", name: "flow", status: "running", ...params } as never });
  const updated = foldWorkflowNotice(status(), run("workflow.run.updated", { steps_expected: 5 }))!;
  expect(updated.status.run.steps_expected).toBe(5);
  const done = foldWorkflowNotice(updated.status, run("workflow.run.done", { status: "done", finished_at: "2026-11-27T08:01:00Z", steps_expected: null, result: { n: 1 }, result_size: 7, summary: "One" }))!;
  expect(done.stale).toBe(false);
  expect(done.status.run).toMatchObject({ status: "done", steps_expected: null, result: { n: 1 }, summary: "One", finished_at: "2026-11-27T08:01:00Z" });
  expect(foldWorkflowNotice(updated.status, run("workflow.run.done", { status: "done", result: null, result_size: 9000 }))!.stale).toBe(true);
});

test("an output is added at its place, again when it is sent again, and a gap asks for a read", () => {
  const output = (params: Record<string, unknown>): WorkflowNotice => ({ kind: "output", method: "workflow.output.added", params: { workflow_run_id: "wr_1", position: 0, size: 5, ...params } as never });
  const first = foldWorkflowNotice(status(), output({ title: "Briefing", summary: "Three things", value: "hello" }))!;
  expect(first.status.run.outputs).toEqual([{ title: "Briefing", summary: "Three things", value: "hello" }]);
  expect(first.status.run.summary).toBe("Three things");
  const again = foldWorkflowNotice(first.status, output({ title: "Briefing", summary: "Three things", value: "hello" }))!;
  expect(again.status.run.outputs).toHaveLength(1);
  expect(foldWorkflowNotice(first.status, output({ position: 3, value: "x" }))!.stale).toBe(true);
  expect(foldWorkflowNotice(status(), output({ value: null, size: 9000 }))!.stale).toBe(true);
});
