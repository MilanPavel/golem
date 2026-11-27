import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { createQueryClient, keepQueriesHonest } from "./query.ts";
import { ev, fakeClient, summary } from "./test-support.ts";

const KEYS = [
  ["skill.list"],
  ["mcp.list"],
  ["mcp.tools", "fs"],
  ["model.list"],
  ["setup.status"],
  ["session.inspect", "a"],
  ["session.inspect", "b"],
  ["daemon.status"],
] as const;

function setup(status: "connecting" | "connected" = "connecting") {
  const fake = fakeClient();
  if (status === "connected") fake.setState({ status: "connected" });
  const queryClient = new QueryClient();
  for (const key of KEYS) queryClient.setQueryData([...key], 1);
  const off = keepQueriesHonest(fake.client, queryClient);
  const stale = () =>
    KEYS.filter((key) => queryClient.getQueryState([...key])?.isInvalidated).map((key) => key.join(":"));
  return { fake, queryClient, off, stale };
}

test("the query client keeps answers fresh and does not refetch on focus", () => {
  const defaults = createQueryClient().getDefaultOptions().queries;
  expect(defaults).toMatchObject({ staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 });
});

test("skills changed marks skill.list", () => {
  const { fake, stale } = setup();
  fake.emitSkills("/repo");
  expect(stale()).toEqual(["skill.list"]);
});

test("mcp status marks mcp.list and mcp.tools", () => {
  const { fake, stale } = setup();
  fake.emitMcp();
  expect(stale()).toEqual(["mcp.list", "mcp.tools:fs"]);
});

test("a finished pull marks model.list, progress does not", () => {
  const { fake, stale } = setup();
  fake.emitPull({ kind: "progress", progress: {} } as never);
  expect(stale()).toEqual([]);
  fake.emitPull({ kind: "done", done: {} } as never);
  expect(stale()).toEqual(["model.list", "setup.status"]);
});

test("a local model server changing state marks model.list and setup.status", () => {
  const { fake, stale } = setup();
  fake.emitModelServer({ base_url: "http://localhost:11434", provider: "ollama", state: "stopped" });
  expect(stale()).toEqual(["model.list", "setup.status"]);
});

test("session.updated and a summary mark only that session's inspect", () => {
  const { fake, stale } = setup();
  fake.emitEvent(ev("a", "session.updated", { title: "T" }));
  expect(stale()).toEqual(["session.inspect:a"]);
  fake.emitEvent(ev("b", "run.completed", {}));
  expect(stale()).toEqual(["session.inspect:a"]);
  fake.emitSummary(summary("b", "2026-11-01T10:00:00Z"));
  expect(stale()).toEqual(["session.inspect:a", "session.inspect:b"]);
});

const CACHED = { run: { workflow_run_id: "wr_1", status: "running", outputs: [] }, steps: [{ key: "a", kind: "step", title: "A", status: "running", attempts: 1 }], reviews: [] };

test("a run notification marks run.list and is folded into the cached workflow.status, which is not read again", () => {
  const { fake, queryClient } = setup();
  queryClient.setQueryData(["run.list"], 1);
  queryClient.setQueryData(["workflow.status", "wr_1"], CACHED);
  fake.emitWorkflow({ kind: "run", method: "workflow.run.updated", params: { workflow_run_id: "wr_1", status: "running", steps_expected: 4 } as never });
  expect(queryClient.getQueryState(["run.list"])?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(["workflow.status", "wr_1"])?.isInvalidated).toBe(false);
  expect((queryClient.getQueryData(["workflow.status", "wr_1"]) as typeof CACHED & { run: { steps_expected: number } }).run.steps_expected).toBe(4);
});

test("a step or an output is folded in with no read, and leaves run.list alone", () => {
  const { fake, queryClient } = setup();
  queryClient.setQueryData(["run.list"], 1);
  queryClient.setQueryData(["workflow.status", "wr_1"], CACHED);
  fake.emitWorkflow({ kind: "step", method: "workflow.step.done", params: { workflow_run_id: "wr_1", key: "a", kind: "step", title: "A", status: "done", attempts: 1, line: "ok", result: "ok", result_size: 4 } as never });
  fake.emitWorkflow({ kind: "output", method: "workflow.output.added", params: { workflow_run_id: "wr_1", position: 0, title: "T", value: "v", size: 3 } as never });
  expect(queryClient.getQueryState(["run.list"])?.isInvalidated).toBe(false);
  expect(queryClient.getQueryState(["workflow.status", "wr_1"])?.isInvalidated).toBe(false);
  const now = queryClient.getQueryData(["workflow.status", "wr_1"]) as typeof CACHED & { steps: { line: string }[]; run: { outputs: unknown[] } };
  expect([now.steps[0]!.line, now.run.outputs.length]).toEqual(["ok", 1]);
});

test("a result that an event left out, or a run nobody has read yet, marks workflow.status", () => {
  const { fake, queryClient } = setup();
  queryClient.setQueryData(["workflow.status", "wr_1"], CACHED);
  fake.emitWorkflow({ kind: "step", method: "workflow.step.done", params: { workflow_run_id: "wr_1", key: "a", kind: "step", title: "A", status: "done", attempts: 1, result: null, result_size: 9000 } as never });
  expect(queryClient.getQueryState(["workflow.status", "wr_1"])?.isInvalidated).toBe(true);
  queryClient.setQueryData(["workflow.status", "wr_2"], 1);
  fake.emitWorkflow({ kind: "step", method: "workflow.step.done", params: { workflow_run_id: "wr_3", key: "a", status: "done" } as never });
  expect(queryClient.getQueryState(["workflow.status", "wr_2"])?.isInvalidated).toBe(false);
});

test("the first connect marks nothing, a reconnect marks everything", () => {
  const { fake, stale } = setup();
  fake.setState({ status: "connected" });
  expect(stale()).toEqual([]);
  fake.setState({ status: "reconnecting", attempt: 1, delayMs: 0 });
  expect(stale()).toEqual([]);
  fake.setState({ status: "connected" });
  expect(stale()).toHaveLength(KEYS.length);
});

test("the unsubscribe stops every wiring", () => {
  const { fake, off, stale } = setup();
  off();
  fake.emitSkills();
  fake.emitMcp();
  expect(stale()).toEqual([]);
});
