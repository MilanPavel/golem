/** The project's checks, folded per turn from the `check.*` events, and the words both screens use for them. */

import type { ChatEvent } from "@golem/client";

export type CheckStatus = "running" | "passed" | "failed" | "timed_out";

export type CheckRun = {
  checkId: string;
  name: string;
  command: string;
  round: number;
  status: CheckStatus;
  exitCode: number | null;
  durationMs: number | null;
  output: string;
  artifactId: string | null;
};

/** The checks of one run, in the order they started. */
export type TurnChecks = { runId: string; runs: CheckRun[] };

/**
 * `turns` in order of first check. `offered` is the question the session has not answered, from
 * `check.offered`. `allowed` is the answer: null until `session.checks.changed` says yes or no.
 */
export type ChecksState = {
  turns: TurnChecks[];
  offered: { name: string; command: string }[] | null;
  allowed: boolean | null;
};

export const noChecks: ChecksState = { turns: [], offered: null, allowed: null };

export type ChecksTone = "run" | "ok" | "bad";

/** Characters of a failed check's output the terminal shows, as rows. */
export const CHECK_OUTPUT_ROWS = 6;

/** Folds one event in. An event that is not about checks returns the same state object. */
export function reduceChecks(state: ChecksState, event: ChatEvent): ChecksState {
  switch (event.type) {
    case "check.offered":
      return { ...state, offered: event.data.checks.map((check) => ({ name: check.name, command: check.command })) };
    case "session.checks.changed":
      return { ...state, allowed: event.data.on, offered: null };
    case "check.started": {
      if (event.run_id === null) {
        return state;
      }
      const data = event.data;
      return withRun(state, event.run_id, data.check_id, (before) => ({
        checkId: data.check_id,
        name: data.name,
        command: data.command,
        round: data.round ?? 0,
        status: "running",
        exitCode: null,
        durationMs: null,
        output: "",
        artifactId: before?.artifactId ?? null,
      }));
    }
    case "check.completed": {
      if (event.run_id === null) {
        return state;
      }
      const data = event.data;
      return withRun(state, event.run_id, data.check_id, (before) => ({
        checkId: data.check_id,
        name: data.name,
        command: before?.command ?? "",
        round: data.round ?? before?.round ?? 0,
        status: data.status,
        exitCode: data.exit_code,
        durationMs: data.duration_ms,
        output: data.output,
        artifactId: data.artifact_id ?? null,
      }));
    }
    default:
      return state;
  }
}

function withRun(
  state: ChecksState,
  runId: string,
  checkId: string,
  make: (before: CheckRun | undefined) => CheckRun,
): ChecksState {
  const at = state.turns.findIndex((turn) => turn.runId === runId);
  const turn: TurnChecks = state.turns[at] ?? { runId, runs: [] };
  const index = turn.runs.findIndex((run) => run.checkId === checkId);
  const run = make(turn.runs[index]);
  const runs = [...turn.runs];
  runs[index < 0 ? runs.length : index] = run;
  const turns = [...state.turns];
  turns[at < 0 ? turns.length : at] = { runId, runs };
  return { ...state, turns };
}

/** The checks of one run, or null when it ran none. */
export function checksOf(state: ChecksState, runId: string | null | undefined): TurnChecks | null {
  if (runId === null || runId === undefined) {
    return null;
  }
  return state.turns.find((turn) => turn.runId === runId) ?? null;
}

/** The runs of the highest round of a turn. */
export function latestRound(turn: TurnChecks): CheckRun[] {
  const top = Math.max(0, ...turn.runs.map((run) => run.round));
  return turn.runs.filter((run) => run.round === top);
}

/** `6.2 s`, one decimal. */
export function checkSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

export function checkMark(status: CheckStatus): string {
  return status === "passed" ? "✓" : status === "running" ? "…" : "✗";
}

/**
 * The strip under a turn. It looks at the highest round: all passed is `✓ checks passed`, one still
 * running is `◐ checking…`, and a failure is `✗ ruff: failed`. A failure is being fixed while the
 * run goes on (`running`), and is final once it has ended.
 */
export function checksSummary(turn: TurnChecks, running = false): { tone: ChecksTone; text: string; detail: string } {
  const round = latestRound(turn);
  if (round.some((run) => run.status === "running")) {
    return {
      tone: "run",
      text: "◐ checking…",
      detail: round.map((run) => (run.status === "running" ? `${run.name} running` : `${run.name} ${checkMark(run.status)}`)).join(" · "),
    };
  }
  const failed = round.find((run) => run.status !== "passed");
  if (failed === undefined) {
    const total = round.reduce((sum, run) => sum + (run.durationMs ?? 0), 0);
    return { tone: "ok", text: "✓ checks passed", detail: [...round.map((run) => run.name), checkSeconds(total)].join(" · ") };
  }
  const why = failed.status === "timed_out" ? "timed out" : "failed";
  const rounds = failed.round;
  let detail: string;
  if (running) {
    detail = `golem is fixing · round ${rounds + 1}`;
  } else if (rounds === 0) {
    detail = "still failing";
  } else {
    detail = `still failing after ${rounds} ${rounds === 1 ? "round" : "rounds"}`;
  }
  return { tone: "bad", text: `✗ ${failed.name}: ${why}`, detail };
}

/** The end of a check's output: at most `rows` rows, without trailing blank ones. */
export function outputTail(output: string, rows = CHECK_OUTPUT_ROWS): string[] {
  const lines = output.replace(/\s+$/, "").split("\n");
  return output.trim() === "" ? [] : lines.slice(-rows);
}

/** The question above the composer. */
export function checksQuestion(offered: readonly { name: string; command: string }[]): { text: string; commands: string[] } {
  return { text: "Run checks after golem edits?", commands: offered.map((check) => check.command) };
}

/** What `/checks on` and `/checks off` say once the daemon has the answer. */
export function checksChanged(on: boolean): string {
  return on ? "Checks run after golem edits in this chat." : "Checks do not run in this chat.";
}
