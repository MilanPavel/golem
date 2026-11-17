import type { RoutineInfo, RoutineListResult, RoutineRunSummary } from "../../store/routines.ts";

/** "Now" for the samples: a Tuesday evening, 14 hours before the morning run, so the next run of a weekday routine is the morning after. */
export const ROUTINES_NOW = Date.parse("2026-11-17T18:30:00+01:00");

const run = (id: string, extra: Partial<RoutineRunSummary>): RoutineRunSummary => ({
  routine_run_id: id,
  routine: "morning-brief",
  scope: "user",
  trigger: "schedule",
  status: "succeeded",
  ...extra,
});

export const SAMPLE_RUNS: RoutineRunSummary[] = [
  run("rr_5", { status: "waiting", started_at: "2026-11-17T08:30:00+01:00", session_id: "s_5", summary: "waiting for approval: gh pr list" }),
  run("rr_4", { started_at: "2026-11-16T08:30:00+01:00", ended_at: "2026-11-16T08:32:14+01:00", session_id: "s_4", summary: "12 PRs, 3 failing checks, 5 Linear issues" }),
  run("rr_3", { status: "failed", trigger: "manual", started_at: "2026-11-13T09:10:00+01:00", ended_at: "2026-11-13T09:10:18+01:00", session_id: "s_3", reason: "Linear: needs sign-in" }),
  run("rr_2", { status: "skipped", due_at: "2026-11-12T08:30:00+01:00", reason: "paused" }),
  run("rr_1", { started_at: "2026-11-11T08:30:00+01:00", ended_at: "2026-11-11T08:32:03+01:00", session_id: "s_1", summary: "10 PRs, 0 failing checks, 6 Linear issues" }),
];

export const SAMPLE_MORNING_BRIEF: RoutineInfo = {
  config: { name: "morning-brief", schedule: "weekdays 08:30", prompt: "/morning-brief", folder: "~/repos/golem", mcp: ["linear", "github"], missed: "run_once" },
  next_at: "2026-11-18T08:30:00+01:00",
  last: SAMPLE_RUNS[0] ?? null,
  path: "/Users/you/.golem/config.toml",
  source: "user",
};

export const SAMPLE_ROUTINES: RoutineInfo[] = [
  SAMPLE_MORNING_BRIEF,
  {
    config: { name: "sentry-triage", schedule: "every 1h", prompt: "Triage new Sentry issues", folder: "~/repos/golem" },
    next_at: "2026-11-17T19:00:00+01:00",
    last: run("rr_9", { routine: "sentry-triage", status: "failed", reason: "Sentry: needs sign-in" }),
    path: "/Users/you/.golem/config.toml",
    source: "user",
  },
  {
    config: { name: "receipts", on: { watch: "~/Downloads", glob: "*.pdf" }, prompt: "File this receipt: {path}" },
    last: run("rr_8", { routine: "receipts", summary: "filed 2 receipts" }),
    path: "/Users/you/.golem/config.toml",
    source: "user",
  },
  {
    config: { name: "dep-report", schedule: "weekly mon 06:00", prompt: "Report outdated dependencies", enabled: false },
    path: "/Users/you/.golem/config.toml",
    source: "user",
  },
  {
    config: { name: "release-notes", schedule: "0 17 * * 5", prompt: "Draft the release notes", folder: "/Users/you/repos/site" },
    folder: "/Users/you/repos/site",
    next_at: "2026-11-20T17:00:00+01:00",
    path: "/Users/you/repos/site/.golem/config.toml",
    source: "project",
  },
];

export const SAMPLE_LIST: RoutineListResult = {
  routines: SAMPLE_ROUTINES,
  issues: [{ file: "/Users/you/.golem/config.toml", line: 42, message: "bad-one: schedule is not a time" }],
};
