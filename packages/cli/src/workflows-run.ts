import type { GolemClient, WorkflowEntryInfo, WorkflowNotice, WorkflowStatusResult } from "@golem/client";

/** What `golem workflow` needs from the daemon: a fake stands in for it in the tests. */
export type WorkflowClient = Pick<GolemClient, "listWorkflows" | "startWorkflow" | "workflowStatus" | "cancelWorkflow" | "onWorkflowEvent">;

/** What the commands need from outside: the folder, the terminal, and Ctrl-C. */
export interface WorkflowDeps {
  /** The project folder. */
  cwd: string;
  write(line: string): void;
  error(line: string): void;
  /** Calls `handler` when the person presses Ctrl-C. Returns the way to stop listening. */
  onInterrupt(handler: () => void): () => void;
}

export const WORKFLOW_USAGE = "usage: golem workflow [list] | golem workflow run <name|id> [--input k=v]… | golem workflow status <workflow_run_id>";

export type WorkflowParse =
  | { kind: "list" }
  | { kind: "run"; name: string; inputs: Record<string, string> }
  | { kind: "status"; runId: string }
  | { kind: "error"; message: string };

/** The words after `golem workflow`. */
export function parseWorkflowArgs(given: readonly string[]): WorkflowParse {
  const fail = (message: string = WORKFLOW_USAGE): WorkflowParse => ({ kind: "error", message });
  const [sub, ...rest] = given;
  if (sub === undefined || sub === "list") return rest.length === 0 ? { kind: "list" } : fail();
  if (sub === "status") {
    const [runId, ...extra] = rest;
    return runId === undefined || runId.startsWith("-") || extra.length > 0 ? fail() : { kind: "status", runId };
  }
  if (sub === "run") {
    let name: string | undefined;
    const inputs: Record<string, string> = {};
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i] as string;
      if (arg === "--input" || arg === "-i") {
        const pair = rest[i + 1] ?? "";
        const at = pair.indexOf("=");
        if (at < 1) return fail("--input takes key=value, for example --input days=7");
        inputs[pair.slice(0, at)] = pair.slice(at + 1);
        i += 1;
      } else if (arg.startsWith("-") || name !== undefined) {
        return fail();
      } else {
        name = arg;
      }
    }
    return name === undefined ? fail() : { kind: "run", name, inputs };
  }
  return fail();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One line of a broken file's error: the last one, where a Python traceback names the cause. */
export function errorLine(text: string | null | undefined): string {
  const lines = (text ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
  return lines.at(-1) ?? "";
}

function triggerText(entry: WorkflowEntryInfo): string {
  const trigger = entry.trigger;
  if (trigger === undefined || trigger === null) return "-";
  if (trigger.kind === "schedule") return `schedule ${trigger.expr ?? ""}`.trim();
  if (trigger.kind === "on_file") return `on file ${trigger.path ?? ""}`.trim();
  return "manual";
}

/** The table of `golem workflow list`: name, project, state, trigger; a file that is not usable shows why. */
export function formatWorkflows(entries: readonly WorkflowEntryInfo[], cwd: string): string {
  if (entries.length === 0) return "no workflows. Add a .py file with an @workflow function to ~/.golem/workflows or <project>/workflows.";
  const rows = entries.map((entry) => [
    entry.name,
    entry.project === undefined || entry.project === null ? "(user)" : entry.project === cwd ? "." : entry.project,
    entry.state,
    entry.state === "ok" ? triggerText(entry) : errorLine(entry.error),
  ]);
  const head = ["NAME", "PROJECT", "STATE", "TRIGGER"];
  const widths = head.map((title, col) => Math.max(title.length, ...rows.map((row) => (row[col] as string).length)));
  const line = (cells: readonly string[]): string => cells.map((cell, col) => (col === cells.length - 1 ? cell : cell.padEnd(widths[col] as number))).join("  ").trimEnd();
  return [line(head), ...rows.map(line)].join("\n");
}

/** `golem workflow [list]`. */
export async function runWorkflowList(client: WorkflowClient, deps: WorkflowDeps): Promise<number> {
  try {
    const listed = await client.listWorkflows([deps.cwd]);
    deps.write(formatWorkflows(listed.workflows, deps.cwd));
    return 0;
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
}

/** The seconds between two ISO times, as "340ms" or "1.2s". Empty when either is missing. */
export function duration(from: string | null | undefined, to: string | null | undefined): string {
  if (from === undefined || from === null || to === undefined || to === null) return "";
  const ms = Date.parse(to) - Date.parse(from);
  if (Number.isNaN(ms) || ms < 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

/** A step event as one line: `started`, `done 1.2s` or `failed: reason`, with the title and the group it runs in. */
export function stepLine(notice: Extract<WorkflowNotice, { kind: "step" }>): string {
  const step = notice.params;
  const what = notice.method.slice("workflow.step.".length);
  const group = step.group === undefined || step.group === null ? "" : ` [${step.group}]`;
  const took = what === "done" || what === "failed" ? duration(step.started_at, step.finished_at) : "";
  const tail = what === "failed" && step.error !== undefined && step.error !== null ? `: ${errorLine(step.error)}` : took === "" ? "" : ` ${took}`;
  return `  ${what.padEnd(8)} ${step.title}${group}${tail}`;
}

const FINAL = new Set(["workflow.run.done", "workflow.run.failed", "workflow.run.cancelled"]);

/** Finds the entry an argument names: the exact id, or the name when one workflow has it. */
export function pickWorkflow(entries: readonly WorkflowEntryInfo[], given: string): WorkflowEntryInfo | string {
  const byId = entries.find((entry) => entry.id === given);
  if (byId !== undefined) return byId;
  const named = entries.filter((entry) => entry.name === given);
  if (named.length === 1) return named[0] as WorkflowEntryInfo;
  if (named.length > 1) return `${given} is in more than one place; run it by id:\n${named.map((entry) => `  ${entry.id}`).join("\n")}`;
  return `there is no workflow called ${given}. See: golem workflow list`;
}

/**
 * `golem workflow run <name|id> [--input k=v]…`: starts the run and prints each step as it starts and ends,
 * until the run finishes. 0 when it is done, 1 when it failed or was refused, 130 after Ctrl-C stopped it.
 */
export async function runWorkflowRun(client: WorkflowClient, args: { name: string; inputs: Record<string, string> }, deps: WorkflowDeps): Promise<number> {
  const buffered: WorkflowNotice[] = [];
  let runId: string | null = null;
  let finish: (notice: Extract<WorkflowNotice, { kind: "run" }>) => void = () => undefined;
  const ended = new Promise<Extract<WorkflowNotice, { kind: "run" }>>((done) => {
    finish = done;
  });
  const show = (notice: WorkflowNotice): void => {
    if (notice.params.workflow_run_id !== runId) return;
    if (notice.kind === "step") {
      if (notice.method !== "workflow.step.waiting") deps.write(stepLine(notice));
    } else if (FINAL.has(notice.method)) {
      finish(notice);
    }
  };
  // Listen before starting: the first events can arrive before `workflow.start` answers.
  const stop = client.onWorkflowEvent((notice) => {
    if (runId === null) buffered.push(notice);
    else show(notice);
  });
  let release: () => void = () => undefined;
  try {
    const listed = await client.listWorkflows([deps.cwd]);
    const picked = pickWorkflow(listed.workflows, args.name);
    if (typeof picked === "string") {
      deps.error(picked);
      return 1;
    }
    if (picked.state !== "ok") {
      const why = errorLine(picked.error);
      deps.error(`${picked.name} is ${picked.state}${why === "" ? "" : `: ${why}`}`);
      return 1;
    }
    const started = await client.startWorkflow(picked.id, args.inputs);
    runId = started.workflow_run_id;
    deps.error(`run: ${runId}`);
    for (const notice of buffered.splice(0)) show(notice);
    let interrupted = false;
    release = deps.onInterrupt(() => {
      if (interrupted) return;
      interrupted = true;
      deps.error("stopping the run…");
      client.cancelWorkflow(started.workflow_run_id).catch((error: unknown) => deps.error(message(error)));
    });
    const last = await ended;
    const run = last.params;
    const took = duration(run.started_at, run.finished_at);
    if (last.method === "workflow.run.done") {
      deps.write(`${picked.name} done${took === "" ? "" : ` in ${took}`}`);
      return 0;
    }
    if (last.method === "workflow.run.cancelled") {
      deps.error(`${picked.name} cancelled`);
      return 130;
    }
    deps.error(`${picked.name} failed${run.error === undefined || run.error === null ? "" : `: ${errorLine(run.error)}`}`);
    return 1;
  } catch (error) {
    deps.error(message(error));
    return 1;
  } finally {
    release();
    stop();
  }
}

/** `golem workflow status <workflow_run_id>`: the run and its steps, as they are stored. */
export async function runWorkflowStatus(client: WorkflowClient, runId: string, deps: WorkflowDeps): Promise<number> {
  try {
    const got: WorkflowStatusResult = await client.workflowStatus(runId);
    const run = got.run;
    const took = duration(run.started_at, run.finished_at);
    deps.write(`${run.name} ${run.status}${took === "" ? "" : ` in ${took}`}${run.error === undefined || run.error === null ? "" : `: ${errorLine(run.error)}`}`);
    for (const step of got.steps ?? []) {
      const group = step.group === undefined || step.group === null ? "" : ` [${step.group}]`;
      const stepTook = duration(step.started_at, step.finished_at);
      const why = step.error === undefined || step.error === null ? "" : `: ${errorLine(step.error)}`;
      deps.write(`  ${step.status.padEnd(8)} ${step.title}${group}${stepTook === "" ? "" : ` ${stepTook}`}${why}`);
    }
    return run.status === "failed" ? 1 : 0;
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
}
