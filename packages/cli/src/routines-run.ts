import type { GolemClient, RoutineRunSummary } from "@golem/client";

import { EXIT_APPROVAL, formatApproval } from "./ask.ts";
import { formatRoutines } from "./format-routines.ts";

/** What `golem routines` needs from the daemon: a fake stands in for it in the tests. */
export type RoutinesClient = Pick<GolemClient, "listRoutines" | "getRoutine" | "runRoutine" | "updateRoutine">;

/** What the commands need from outside: the terminal, the clock, and for `edit` the editor and the file. */
export interface RoutinesDeps {
  /** The project folder. */
  cwd: string;
  now(): Date;
  /** The user's `config.toml`. */
  configPath: string;
  /** Terminal width, when there is a terminal. */
  columns?: number;
  /** Opens the file in the editor, at `line` when the editor takes one. False when the editor failed. */
  editFile(path: string, line?: number): Promise<boolean>;
  /** The text of the file, or null when there is none. */
  readFile(path: string): string | null;
  /** Waits between two looks at a running routine. */
  sleep(ms: number): Promise<void>;
  write(line: string): void;
  error(line: string): void;
}

export const ROUTINES_USAGE =
  "usage: golem routines [list] | golem routines run <name> [--folder <dir>] [--wait] | golem routines pause <name> | golem routines resume <name> | golem routines edit";

export type RoutinesParse =
  | { kind: "list" }
  | { kind: "run"; name: string; folder?: string; wait: boolean }
  | { kind: "pause" | "resume"; name: string }
  | { kind: "edit" }
  | { kind: "error"; message: string };

/** The words after `golem routines`. */
export function parseRoutinesArgs(given: readonly string[], cwd: string): RoutinesParse {
  const fail = (message: string = ROUTINES_USAGE): RoutinesParse => ({ kind: "error", message });
  const [sub, ...rest] = given;
  if (sub === undefined || sub === "list") return rest.length === 0 ? { kind: "list" } : fail();
  if (sub === "edit") return rest.length === 0 ? { kind: "edit" } : fail();
  if (sub === "pause" || sub === "resume") {
    if (rest.includes("--all")) return fail(`golem routines ${sub} --all is not offered yet: ${sub} one routine by name`);
    const [name, ...extra] = rest;
    return name === undefined || name.startsWith("-") || extra.length > 0 ? fail() : { kind: sub, name };
  }
  if (sub === "run") {
    let name: string | undefined;
    let folder: string | undefined;
    let wait = false;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i] as string;
      if (arg === "--wait" && !wait) {
        wait = true;
      } else if (arg === "--folder") {
        const value = rest[i + 1];
        if (value === undefined || value === "" || value.startsWith("--") || folder !== undefined) return fail();
        folder = value.startsWith("/") ? value : `${cwd.replace(/\/$/, "")}/${value}`;
        i += 1;
      } else if (arg.startsWith("-") || name !== undefined) {
        return fail();
      } else {
        name = arg;
      }
    }
    if (name === undefined) return fail();
    return folder === undefined ? { kind: "run", name, wait } : { kind: "run", name, folder, wait };
  }
  return fail();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `golem routines [list]`: this user's routines, and those of the project in this folder. */
export async function runRoutinesList(client: RoutinesClient, deps: RoutinesDeps): Promise<number> {
  try {
    const listed = await client.listRoutines([deps.cwd]);
    deps.write(formatRoutines(listed.routines, deps.now(), deps.columns));
    for (const issue of listed.issues ?? []) deps.error(formatIssue(issue));
    return 0;
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
}

function formatIssue(issue: { file: string; line?: number | null; message: string }): string {
  return `${issue.file}${issue.line === undefined || issue.line === null ? "" : `:${issue.line}`}: ${issue.message}`;
}

const WAIT_POLL_MS = 1000;

/** The routine's own firing, once the daemon has finished it or is waiting on the person. Null while it runs. */
async function settled(client: RoutinesClient, name: string, folder: string | undefined, runId: string): Promise<RoutineRunSummary | null> {
  const got = await client.getRoutine(name, folder);
  const run = (got.runs ?? []).find((candidate) => candidate.routine_run_id === runId);
  return run !== undefined && run.status !== "queued" && run.status !== "running" ? run : null;
}

/**
 * `golem routines run <name> [--wait]`: fires it now and prints the session id (the firing id for a workflow run that has no session). With `--wait` it waits for the firing,
 * like `golem ask`: the summary on stdout and 0, or the reason on stderr and 1 when it failed or was skipped,
 * or the question and how to answer it and 3 when it stops for an approval.
 */
export async function runRoutinesRun(client: RoutinesClient, args: { name: string; folder?: string; wait: boolean }, deps: RoutinesDeps): Promise<number> {
  try {
    const started = await client.runRoutine(args.name, args.folder);
    if (!args.wait) {
      deps.write(started.session_id ?? started.routine_run_id);
      return 0;
    }
    // A workflow run has no session until a step needs one; the firing's id names it then.
    deps.error(started.session_id === undefined || started.session_id === null ? `run: ${started.routine_run_id}` : `session: ${started.session_id}`);
    let run = await settled(client, args.name, args.folder, started.routine_run_id);
    while (run === null) {
      await deps.sleep(WAIT_POLL_MS);
      run = await settled(client, args.name, args.folder, started.routine_run_id);
    }
    if (run.status === "waiting") {
      deps.error(
        started.session_id === undefined || started.session_id === null
          ? `${args.name} is waiting for your answer. Answer it on the Runs page, or in /runs in the terminal.`
          : formatApproval(started.session_id, { name: args.name }).join("\n"),
      );
      return EXIT_APPROVAL;
    }
    if (run.status === "succeeded") {
      const text = run.summary ?? "";
      if (text !== "") deps.write(text.replace(/\n$/, ""));
      return 0;
    }
    const why = run.reason ?? run.summary ?? "";
    deps.error(`${args.name} ${run.status}${why === "" ? "" : `: ${why}`}`);
    return 1;
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
}

/** `golem routines pause|resume <name>`: writes `enabled` in the routine's `config.toml`. */
export async function runRoutinesPause(client: RoutinesClient, name: string, paused: boolean, deps: RoutinesDeps): Promise<number> {
  try {
    await client.updateRoutine(name, { enabled: !paused });
    deps.write(`${paused ? "paused" : "resumed"} ${name}`);
    return 0;
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
}

/** The 1-based line of the first `[[routine]]`, or null when there is none. */
export function firstRoutineLine(text: string): number | null {
  const index = text.split("\n").findIndex((line) => /^\s*\[\[\s*routine\s*\]\]/.test(line));
  return index < 0 ? null : index + 1;
}

/** `golem routines edit`: `config.toml` in `$EDITOR` at the first `[[routine]]`, then the daemon's check of it, with lines. */
export async function runRoutinesEdit(client: RoutinesClient, deps: RoutinesDeps): Promise<number> {
  const text = deps.readFile(deps.configPath);
  const line = text === null ? undefined : (firstRoutineLine(text) ?? undefined);
  if (!(await deps.editFile(deps.configPath, line))) {
    deps.error(`the editor did not finish: ${deps.configPath} is as the editor left it`);
    return 1;
  }
  try {
    const listed = await client.listRoutines([deps.cwd]);
    const issues = listed.issues ?? [];
    if (issues.length === 0) {
      deps.write(`${deps.configPath} is fine: ${listed.routines.length} ${listed.routines.length === 1 ? "routine" : "routines"}`);
      return 0;
    }
    for (const issue of issues) deps.error(formatIssue(issue));
    deps.error(`fix it with: golem routines edit`);
    return 1;
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
}
