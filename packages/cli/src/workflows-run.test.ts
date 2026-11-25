import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkflowEntryInfo, WorkflowNotice } from "@golem/client";

import {
  duration,
  errorLine,
  formatWorkflows,
  parseWorkflowArgs,
  pickWorkflow,
  runWorkflowList,
  runWorkflowRun,
  runWorkflowStatus,
  type WorkflowClient,
  type WorkflowDeps,
} from "./workflows-run.ts";

const ok: WorkflowEntryInfo = {
  id: "/h/workflows/adder.py::adder",
  name: "adder",
  path: "/h/workflows/adder.py",
  state: "ok",
  trigger: { kind: "schedule", expr: "daily 08:00" },
  inputs: [],
  description: "",
};
const broken: WorkflowEntryInfo = {
  id: "/work/proj/workflows/bad.py",
  name: "bad",
  path: "/work/proj/workflows/bad.py",
  project: "/work/proj",
  state: "broken",
  error: 'Traceback (most recent call last):\n  File "bad.py", line 1\nSyntaxError: invalid syntax\n',
  inputs: [],
  description: "",
};

const T0 = "2026-11-25T10:00:00+00:00";
const T1 = "2026-11-25T10:00:01.500+00:00";

function runNotice(method: string, status: string, error?: string): WorkflowNotice {
  return {
    kind: "run",
    method,
    params: { workflow_run_id: "wr1", workflow_id: ok.id, name: "adder", status, started_at: T0, finished_at: T1, ...(error === undefined ? {} : { error }) } as never,
  };
}

function stepNotice(method: string, key: string, status: string, rest: Record<string, unknown> = {}): WorkflowNotice {
  return { kind: "step", method, params: { workflow_run_id: "wr1", key, kind: "step", title: key, status, started_at: T0, finished_at: T1, ...rest } as never };
}

/** A daemon whose run sends `script` once it is started, and records what it was asked. */
function fake(script: WorkflowNotice[], entries: WorkflowEntryInfo[] = [ok, broken]) {
  const calls: string[] = [];
  let listener: (notice: WorkflowNotice) => void = () => undefined;
  const client: WorkflowClient = {
    listWorkflows: async (folders) => {
      calls.push(`list ${JSON.stringify(folders)}`);
      return { workflows: entries };
    },
    startWorkflow: async (id, inputs) => {
      calls.push(`start ${id} ${JSON.stringify(inputs)}`);
      // The first events can arrive before the answer does.
      if (script[0] !== undefined) listener(script[0]);
      setTimeout(() => script.slice(1).forEach((notice) => listener(notice)), 0);
      return { workflow_run_id: "wr1" };
    },
    workflowStatus: async (id) => {
      calls.push(`status ${id}`);
      return {
        run: { workflow_run_id: id, workflow_id: ok.id, name: "adder", status: "failed", trigger: "manual", inputs: {}, error: "ValueError: boom" },
        steps: [{ key: "first", kind: "step", title: "first", status: "done", started_at: T0, finished_at: T1 }],
      };
    },
    cancelWorkflow: async (id) => {
      calls.push(`cancel ${id}`);
      setTimeout(() => listener(runNotice("workflow.run.cancelled", "cancelled")), 0);
      return { cancelled: true };
    },
    onWorkflowEvent: (next) => {
      listener = next;
      return () => {
        listener = () => undefined;
      };
    },
  };
  return { client, calls };
}

function setup(overrides: Partial<WorkflowDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WorkflowDeps = {
    cwd: "/work/proj",
    write: (line) => out.push(line),
    error: (line) => err.push(line),
    onInterrupt: () => () => undefined,
    ...overrides,
  };
  return { deps, out, err };
}

test("the arguments parse, and the ones that do not fit are errors", () => {
  assert.deepEqual(parseWorkflowArgs([]), { kind: "list" });
  assert.deepEqual(parseWorkflowArgs(["list"]), { kind: "list" });
  assert.deepEqual(parseWorkflowArgs(["run", "adder"]), { kind: "run", name: "adder", inputs: {} });
  assert.deepEqual(parseWorkflowArgs(["run", "adder", "--input", "n=3", "--input", "tag=a=b"]), { kind: "run", name: "adder", inputs: { n: "3", tag: "a=b" } });
  assert.deepEqual(parseWorkflowArgs(["status", "wr1"]), { kind: "status", runId: "wr1" });
  assert.equal(parseWorkflowArgs(["run"]).kind, "error");
  assert.equal(parseWorkflowArgs(["run", "a", "b"]).kind, "error");
  assert.equal(parseWorkflowArgs(["run", "a", "--input", "nokey"]).kind, "error");
  assert.equal(parseWorkflowArgs(["list", "x"]).kind, "error");
  assert.equal(parseWorkflowArgs(["nope"]).kind, "error");
});

test("the table shows name, project, state and trigger, and the last line of a broken file's error", () => {
  const text = formatWorkflows([ok, broken], "/work/proj");
  const lines = text.split("\n");
  assert.match(lines[0] as string, /^NAME\s+PROJECT\s+STATE\s+TRIGGER$/);
  assert.match(lines[1] as string, /^adder\s+\(user\)\s+ok\s+schedule daily 08:00$/);
  assert.match(lines[2] as string, /^bad\s+\.\s+broken\s+SyntaxError: invalid syntax$/);
  assert.match(formatWorkflows([], "/w"), /^no workflows/);
  assert.equal(errorLine("a\n\nb\n"), "b");
});

test("list asks for this folder and prints the table", async () => {
  const { client, calls } = fake([]);
  const { deps, out } = setup();
  assert.equal(await runWorkflowList(client, deps), 0);
  assert.deepEqual(calls, ['list ["/work/proj"]']);
  assert.match(out.join("\n"), /adder/);
});

test("a name picks one workflow, an id picks exactly, and a twice-used name asks for the id", () => {
  const twin = { ...ok, id: "/other/adder.py::adder" };
  assert.equal((pickWorkflow([ok, broken], "adder") as WorkflowEntryInfo).id, ok.id);
  assert.equal((pickWorkflow([ok, twin], ok.id) as WorkflowEntryInfo).id, ok.id);
  assert.match(pickWorkflow([ok, twin], "adder") as string, /more than one place[\s\S]*\/other\/adder.py::adder/);
  assert.match(pickWorkflow([ok], "zzz") as string, /no workflow called zzz/);
});

test("run prints each step as it starts and ends, then the result, and exits 0", async () => {
  const { client, calls } = fake([
    runNotice("workflow.run.started", "running"),
    stepNotice("workflow.step.started", "first", "running"),
    stepNotice("workflow.step.done", "first", "done"),
    stepNotice("workflow.step.started", "p0", "running", { group: "parallel-1" }),
    stepNotice("workflow.step.done", "p0", "done", { group: "parallel-1" }),
    runNotice("workflow.run.done", "done"),
  ]);
  const { deps, out, err } = setup();
  assert.equal(await runWorkflowRun(client, { name: "adder", inputs: { n: "3" } }, deps), 0);
  assert.deepEqual(calls, ['list ["/work/proj"]', `start ${ok.id} {"n":"3"}`]);
  assert.deepEqual(out, ["  started  first", "  done     first 1.5s", "  started  p0 [parallel-1]", "  done     p0 [parallel-1] 1.5s", "adder done in 1.5s"]);
  assert.deepEqual(err, ["run: wr1"]);
});

test("a failed run shows the failed step and the error, and exits 1", async () => {
  const { client } = fake([
    runNotice("workflow.run.started", "running"),
    stepNotice("workflow.step.started", "first", "running"),
    stepNotice("workflow.step.failed", "first", "failed", { error: "ValueError: boom" }),
    runNotice("workflow.run.failed", "failed", "ValueError: boom"),
  ]);
  const { deps, out, err } = setup();
  assert.equal(await runWorkflowRun(client, { name: "adder", inputs: {} }, deps), 1);
  assert.deepEqual(out, ["  started  first", "  failed   first: ValueError: boom"]);
  assert.deepEqual(err, ["run: wr1", "adder failed: ValueError: boom"]);
});

test("a broken workflow and an unknown name are refused without starting", async () => {
  const { client, calls } = fake([]);
  const first = setup();
  assert.equal(await runWorkflowRun(client, { name: "bad", inputs: {} }, first.deps), 1);
  assert.deepEqual(first.err, ["bad is broken: SyntaxError: invalid syntax"]);
  const second = setup();
  assert.equal(await runWorkflowRun(client, { name: "nope", inputs: {} }, second.deps), 1);
  assert.match(second.err[0] as string, /no workflow called nope/);
  assert.ok(calls.every((call) => call.startsWith("list")));
});

test("Ctrl-C asks the daemon to cancel and the command exits 130 when the run is cancelled", async () => {
  let interrupt: () => void = () => undefined;
  const { client, calls } = fake([runNotice("workflow.run.started", "running")]);
  const { deps, err } = setup({
    onInterrupt: (handler) => {
      interrupt = handler;
      return () => undefined;
    },
  });
  const done = runWorkflowRun(client, { name: "adder", inputs: {} }, deps);
  await new Promise((resolve) => setTimeout(resolve, 10));
  interrupt();
  interrupt();
  assert.equal(await done, 130);
  assert.equal(calls.filter((call) => call.startsWith("cancel")).length, 1);
  assert.ok(err.includes("adder cancelled"));
});

test("status prints the run and its steps and exits 1 for a failed run", async () => {
  const { client } = fake([]);
  const { deps, out } = setup();
  assert.equal(await runWorkflowStatus(client, "wr1", deps), 1);
  assert.deepEqual(out, ["adder failed: ValueError: boom", "  done     first 1.5s"]);
});

test("durations are short", () => {
  assert.equal(duration(T0, "2026-11-25T10:00:00.340+00:00"), "340ms");
  assert.equal(duration(T0, T1), "1.5s");
  assert.equal(duration(T0, "2026-11-25T10:02:05+00:00"), "2m05s");
  assert.equal(duration(null, T1), "");
});
