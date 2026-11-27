import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkflowEntryInfo, WorkflowNotice, WorkflowProblem } from "@golem/client";

import {
  duration,
  errorLine,
  formatWorkflows,
  parseWorkflowArgs,
  pickWorkflow,
  runWorkflowAdd,
  runWorkflowAnswer,
  runWorkflowCheck,
  runWorkflowList,
  runWorkflowResume,
  runWorkflowRun,
  runWorkflowStarters,
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

const STARTERS = [
  { id: "fix_check", title: "Fix a failing check", line: "Fixes it in a copy.", needs_folder: true },
  { id: "morning_briefing", title: "Morning briefing", line: "Reads your logs.", needs_folder: false, schedule: "Runs every weekday at 07:30" },
];

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
function fake(script: WorkflowNotice[], entries: WorkflowEntryInfo[] = [ok, broken], problems: WorkflowProblem[] = []) {
  const calls: string[] = [];
  let listener: (notice: WorkflowNotice) => void = () => undefined;
  const client: WorkflowClient = {
    listWorkflows: async (folders) => {
      calls.push(`list ${JSON.stringify(folders)}`);
      return { workflows: entries };
    },
    listWorkflowStarters: async () => {
      calls.push("starters");
      return { starters: STARTERS };
    },
    addWorkflowStarter: async (id, folder) => {
      calls.push(`add ${id} ${folder ?? "-"}`);
      return { id: `/p/workflows/${id}.py::${id}`, name: id, path: `/p/workflows/${id}.py` };
    },
    checkWorkflow: async (id) => {
      calls.push(`check ${id}`);
      return { problems, steps: [] };
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
    resumeWorkflow: async (id) => {
      calls.push(`resume ${id}`);
      if (script[0] !== undefined) listener(script[0]);
      setTimeout(() => script.slice(1).forEach((notice) => listener(notice)), 0);
      return { run: { workflow_run_id: id, workflow_id: ok.id, name: "adder", status: "running", trigger: "manual", inputs: {} } };
    },
    answerWorkflowReview: async (id, key, verdict, text) => {
      calls.push(`answer ${id} ${key} ${verdict}${text === undefined ? "" : ` ${text}`}`);
      if (script[0] !== undefined) listener(script[0]);
      setTimeout(() => script.slice(1).forEach((notice) => listener(notice)), 0);
      return { run: { workflow_run_id: id, workflow_id: ok.id, name: "adder", status: "running", trigger: "manual", inputs: {} } };
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
  assert.deepEqual(parseWorkflowArgs(["resume", "wr1"]), { kind: "resume", runId: "wr1" });
  assert.deepEqual(parseWorkflowArgs(["check", "adder"]), { kind: "check", name: "adder" });
  assert.equal(parseWorkflowArgs(["check"]).kind, "error");
  assert.equal(parseWorkflowArgs(["check", "a", "b"]).kind, "error");
  assert.equal(parseWorkflowArgs(["resume"]).kind, "error");
  assert.equal(parseWorkflowArgs(["resume", "wr1", "x"]).kind, "error");
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

test("resume continues the run by id and prints its steps like run", async () => {
  const { client, calls } = fake([
    runNotice("workflow.run.started", "running"),
    stepNotice("workflow.step.started", "third", "running"),
    stepNotice("workflow.step.done", "third", "done"),
    runNotice("workflow.run.done", "done"),
  ]);
  const { deps, out, err } = setup();
  assert.equal(await runWorkflowResume(client, "wr1", deps), 0);
  assert.deepEqual(calls, ["resume wr1"]);
  assert.deepEqual(out, ["  started  third", "  done     third 1.5s", "adder done in 1.5s"]);
  assert.deepEqual(err, ["run: wr1"]);
});

test("resume reports a refusal from the daemon and exits 1", async () => {
  const { client } = fake([]);
  client.resumeWorkflow = async () => {
    throw new Error("workflow run wr1 is already running");
  };
  const { deps, err } = setup();
  assert.equal(await runWorkflowResume(client, "wr1", deps), 1);
  assert.deepEqual(err, ["workflow run wr1 is already running"]);
});

const waitingStep = (key: string) => ({ key, kind: "review" as const, title: `Ask ${key}`, status: "waiting" as const });

function withReviews(client: WorkflowClient, keys: string[]): void {
  client.workflowStatus = async (id) => ({
    run: { workflow_run_id: id, workflow_id: ok.id, name: "adder", status: "waiting", trigger: "manual", inputs: {} },
    steps: [{ key: "first", kind: "step", title: "first", status: "done" }, ...keys.map(waitingStep)],
  });
}

test("answer parses its run id, key and verdict", () => {
  assert.deepEqual(parseWorkflowArgs(["answer", "wr1"]), { kind: "answer", runId: "wr1", key: null, verdict: "approve", text: null });
  assert.deepEqual(parseWorkflowArgs(["answer", "wr1", "--key", "k", "--edit", "new text"]), { kind: "answer", runId: "wr1", key: "k", verdict: "edit", text: "new text" });
  assert.deepEqual(parseWorkflowArgs(["answer", "wr1", "--reject"]), { kind: "answer", runId: "wr1", key: null, verdict: "reject", text: null });
  assert.equal(parseWorkflowArgs(["answer"]).kind, "error");
  assert.equal(parseWorkflowArgs(["answer", "wr1", "--edit"]).kind, "error");
  assert.equal(parseWorkflowArgs(["answer", "wr1", "--edit", "x", "--reject"]).kind, "error");
  assert.equal(parseWorkflowArgs(["answer", "wr1", "--key"]).kind, "error");
});

test("answer approves the one open review and follows the run to its end", async () => {
  const { client, calls } = fake([
    runNotice("workflow.run.started", "running"),
    stepNotice("workflow.step.done", "review:Send?", "done"),
    runNotice("workflow.run.done", "done"),
  ]);
  withReviews(client, ["review:Send?"]);
  const { deps, out, err } = setup();
  assert.equal(await runWorkflowAnswer(client, { runId: "wr1", key: null, verdict: "approve", text: null }, deps), 0);
  assert.deepEqual(calls, ["answer wr1 review:Send? approve"]);
  assert.deepEqual(out, ["  done     review:Send? 1.5s", "adder done in 1.5s"]);
  assert.deepEqual(err, ["run: wr1"]);
});

test("answer --edit sends the text, and --key picks one of several reviews", async () => {
  const { client, calls } = fake([runNotice("workflow.run.done", "done")]);
  withReviews(client, ["one", "two"]);
  const { deps } = setup();
  assert.equal(await runWorkflowAnswer(client, { runId: "wr1", key: "two", verdict: "edit", text: "better" }, deps), 0);
  assert.deepEqual(calls, ["answer wr1 two edit better"]);
});

test("answer without --key refuses when several reviews or none wait", async () => {
  const several = fake([]);
  withReviews(several.client, ["one", "two"]);
  const first = setup();
  assert.equal(await runWorkflowAnswer(several.client, { runId: "wr1", key: null, verdict: "reject", text: null }, first.deps), 1);
  assert.match(first.err.join("\n"), /waits for 2 reviews; pick one with --key:\n {2}one {2}Ask one\n {2}two {2}Ask two/);
  assert.deepEqual(several.calls, []);

  const none = fake([]);
  withReviews(none.client, []);
  const second = setup();
  assert.equal(await runWorkflowAnswer(none.client, { runId: "wr1", key: null, verdict: "approve", text: null }, second.deps), 1);
  assert.deepEqual(second.err, ["workflow run wr1 waits for no review"]);
});

test("answer reports a refusal from the daemon and exits 1", async () => {
  const { client } = fake([]);
  client.answerWorkflowReview = async () => {
    throw new Error("review 'k' of workflow run wr1 is answered already");
  };
  const { deps, err } = setup();
  assert.equal(await runWorkflowAnswer(client, { runId: "wr1", key: "k", verdict: "approve", text: null }, deps), 1);
  assert.deepEqual(err, ["review 'k' of workflow run wr1 is answered already"]);
});

test("check prints line, step and message, and exits 1 only for an error", async () => {
  const warning: WorkflowProblem = { severity: "warning", line: 9, step_id: "llm:ask", message: "a run would stop at this step" };
  const error: WorkflowProblem = { severity: "error", line: 4, message: "unknown agent 'x'; the agents here are explorer", fix: "explorer" };
  const bad = fake([], [ok], [error, warning]);
  const first = setup();
  assert.equal(await runWorkflowCheck(bad.client, { name: "adder" }, first.deps), 1);
  assert.deepEqual(first.out, [
    "line 4 \u00b7 unknown agent 'x'; the agents here are explorer (fix: explorer)",
    "line 9 \u00b7 step llm:ask \u00b7 warning: a run would stop at this step",
  ]);
  assert.deepEqual(bad.calls, ['list ["/work/proj"]', `check ${ok.id}`]);
  const soft = fake([], [ok], [warning]);
  assert.equal(await runWorkflowCheck(soft.client, { name: "adder" }, setup().deps), 0);
  const clean = fake([], [ok]);
  const third = setup();
  assert.equal(await runWorkflowCheck(clean.client, { name: "adder" }, third.deps), 0);
  assert.deepEqual(third.out, ["adder: no problems"]);
  const missing = setup();
  assert.equal(await runWorkflowCheck(clean.client, { name: "nope" }, missing.deps), 1);
  assert.match(missing.err[0] as string, /no workflow called nope/);
});

test("the starter arguments parse", () => {
  assert.deepEqual(parseWorkflowArgs(["starters"]), { kind: "starters" });
  assert.deepEqual(parseWorkflowArgs(["add", "fix_check"]), { kind: "add", id: "fix_check", folder: null });
  assert.deepEqual(parseWorkflowArgs(["add", "fix_check", "--folder", "/p"]), { kind: "add", id: "fix_check", folder: "/p" });
  for (const bad of [["starters", "x"], ["add"], ["add", "a", "b"], ["add", "a", "--folder"], ["add", "--nope", "a"]]) {
    assert.equal(parseWorkflowArgs(bad).kind, "error", bad.join(" "));
  }
});

test("starters lists them with where each goes", async () => {
  const { client } = fake([]);
  const { deps, out } = setup();
  assert.equal(await runWorkflowStarters(client, deps), 0);
  assert.match(out[0] as string, /^STARTER\s+GOES IN\s+WHAT IT DOES/);
  assert.match(out[0] as string, /fix_check\s+project\s+Fixes it in a copy\./);
  assert.match(out[0] as string, /morning_briefing\s+\(user\)\s+Reads your logs\./);
});

test("add puts a project starter in the current folder, or in --folder, and a user one in no folder", async () => {
  const { client, calls } = fake([]);
  const { deps, out } = setup();
  assert.equal(await runWorkflowAdd(client, { id: "fix_check", folder: null }, deps), 0);
  assert.equal(await runWorkflowAdd(client, { id: "fix_check", folder: "../other" }, deps), 0);
  assert.equal(await runWorkflowAdd(client, { id: "morning_briefing", folder: null }, deps), 0);
  assert.deepEqual(calls.filter((c) => c.startsWith("add")), ["add fix_check /work/proj", "add fix_check /work/other", "add morning_briefing -"]);
  assert.match(out[0] as string, /^added fix_check: \/p\/workflows\/fix_check\.py$/);
});

test("add says so for an unknown starter, and shows the daemon's reason when it refuses", async () => {
  const { client } = fake([]);
  const first = setup();
  assert.equal(await runWorkflowAdd(client, { id: "nope", folder: null }, first.deps), 1);
  assert.match(first.err[0] as string, /no starter called nope.*golem workflow starters/);
  const refusing: WorkflowClient = { ...client, addWorkflowStarter: async () => Promise.reject(new Error("/work/proj/workflows/fix_check.py exists already")) };
  const second = setup();
  assert.equal(await runWorkflowAdd(refusing, { id: "fix_check", folder: null }, second.deps), 1);
  assert.match(second.err[0] as string, /exists already/);
});
