import type { RunInfo } from "../../store/runs.ts";

/** "Now" for the samples: a Tuesday evening. The runs below are placed relative to it, so Today and Earlier hold in any time zone. */
export const RUNS_NOW = new Date(2026, 10, 17, 18, 30).getTime();

/** An ISO time on the sample's day or an earlier one, in local time. */
const at = (daysBack: number, hour: number, minute: number, second = 0): string => new Date(2026, 10, 17 - daysBack, hour, minute, second).toISOString();

const row = (id: string, extra: Partial<RunInfo>): RunInfo => ({
  session_id: id,
  kind: "routine",
  origin: `routine:${extra.routine ?? "morning-brief"}`,
  routine: "morning-brief",
  routine_run_id: `rr_${id}`,
  trigger: "schedule",
  status: "succeeded",
  approvals: 0,
  ...extra,
});

export const SAMPLE_WAITING_RUN: RunInfo = row("s_wait", {
  routine: "sentry-triage",
  origin: "routine:sentry-triage",
  status: "waiting",
  started_at: at(0, 17, 25),
  approvals: 1,
  summary: "Allow mcp__linear__create_issue: TypeError in router.matchRoute",
});

/** The id of the workflow the filtered Runs page samples are for. */
export const SAMPLE_FILTER_WORKFLOW = "/Users/you/.golem/workflows/pr_digest.py::pr_digest";

const flow = (id: string, extra: Partial<RunInfo>): RunInfo => ({
  session_id: null,
  kind: "workflow",
  origin: "workflow:pr_digest",
  status: "succeeded",
  approvals: 0,
  steps: 5,
  workflow_run_id: id,
  workflow_id: SAMPLE_FILTER_WORKFLOW,
  ...extra,
});

/** Runs of one workflow as the list gets them: a result in a line, nothing found, a failure, a run that goes, and an older run. */
export const SAMPLE_FILTER_RUNS: RunInfo[] = [
  flow("wr_today", { started_at: at(0, 8, 30), ended_at: at(0, 8, 31, 12), summary: "3 things need you" }),
  flow("wr_empty", { started_at: at(0, 7, 30), ended_at: at(0, 7, 30, 40), summary: "Nothing found" }),
  flow("wr_fail", { started_at: at(0, 6, 30), ended_at: at(0, 6, 30, 30), status: "failed", steps: 1, reason: "tool mcp__github__list_pull_requests: needs sign-in", summary: "tool mcp__github__list_pull_requests: needs sign-in" }),
  flow("wr_run", { started_at: at(0, 18, 25), status: "running", steps: 3 }),
  flow("wr_old", { started_at: at(1, 8, 30), ended_at: at(1, 8, 31, 2), summary: "Saved as 2026-11-16.md" }),
];

/** A run of a workflow with the same name in another folder: the filter, which matches by id, leaves it out. */
export const SAMPLE_OTHER_FOLDER_RUN: RunInfo = flow("wr_other_folder", {
  workflow_id: "/Users/you/projects/web/workflows/pr_digest.py::pr_digest",
  started_at: at(0, 9, 5),
  ended_at: at(0, 9, 6),
  summary: "Digest of the web project",
});

/** One run of each kind and state the list shows: waiting, running, today, earlier, a watch firing, and a detached ask. */
export const SAMPLE_RUN_LIST: RunInfo[] = [
  row("s_old", { started_at: at(1, 8, 30), ended_at: at(1, 8, 31, 51), summary: "10 PRs, 0 failing checks" }),
  SAMPLE_WAITING_RUN,
  row("s_run", { routine: "upgrade-dependencies", origin: "routine:upgrade-dependencies", status: "running", trigger: "manual", started_at: at(0, 18, 20) }),
  row("s_brief", { started_at: at(0, 8, 30), ended_at: at(0, 8, 30, 48), summary: "12 PRs, 3 failing checks, 5 Linear issues" }),
  row("s_receipt", {
    routine: "receipts",
    origin: "routine:receipts",
    trigger: "watch",
    watch_path: "/Users/you/Downloads/receipt-0412.pdf",
    started_at: at(0, 9, 40),
    ended_at: at(0, 9, 40, 6),
    summary: "Filed receipt-0412.pdf under Taxes",
  }),
  row("s_fail", { routine: "sentry-triage", origin: "routine:sentry-triage", status: "failed", started_at: at(1, 17, 0), ended_at: at(1, 17, 2, 10), reason: "provider timeout" }),
  {
    session_id: "s_ask",
    kind: "ask",
    origin: "cli",
    status: "cancelled",
    started_at: at(2, 11, 0),
    ended_at: at(2, 11, 0, 30),
    approvals: 0,
  },
];

/** Every run, with those of the workflow among them: the page the filter narrows. */
export const SAMPLE_MIXED_RUNS: RunInfo[] = [...SAMPLE_RUN_LIST, ...SAMPLE_FILTER_RUNS, SAMPLE_OTHER_FOLDER_RUN];
