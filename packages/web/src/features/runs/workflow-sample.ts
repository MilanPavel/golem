import type { WorkflowReviewInfo, WorkflowRunInfo, WorkflowStepInfo } from "../../store/workflows.ts";

/** "Now" for the samples: a Tuesday evening, as the Runs samples have it. */
export const WORKFLOW_RUN_NOW = new Date(2026, 10, 17, 18, 30).getTime();

/** The daemon sends any JSON for a result or a draft; the generated type only knows an object, so a string is cast. */
const raw = <T>(value: unknown): T => value as T;

const at = (minute: number, second = 0): string => new Date(2026, 10, 17, 18, minute, second).toISOString();

const run = (extra: Partial<WorkflowRunInfo>): WorkflowRunInfo => ({
  workflow_run_id: "wr_digest",
  workflow_id: "/Users/you/.golem/workflows/pr_digest.py::pr_digest",
  name: "pr_digest",
  status: "done",
  trigger: "manual",
  inputs: {},
  session_id: "s_digest",
  started_at: at(20),
  finished_at: at(22, 10),
  error: null,
  ...extra,
});

const step = (key: string, extra: Partial<WorkflowStepInfo>): WorkflowStepInfo => ({
  key,
  kind: "step",
  title: key,
  status: "done",
  attempts: 1,
  started_at: at(20),
  finished_at: at(20, 4),
  ...extra,
});

const LIST: WorkflowStepInfo = step("list_prs", {
  kind: "tool",
  title: "list_pull_requests",
  finished_at: at(20, 3),
  result: { summary: "12 pull requests", artifact_id: "a_prs", size: 48211 },
});

const SUMMARISE: WorkflowStepInfo = step("summarise", {
  kind: "llm",
  title: "summarise",
  started_at: at(20, 3),
  finished_at: at(20, 40),
  model: "deepseek/deepseek-chat",
  cost_usd: 0.0123,
  result: raw("Twelve open pull requests. Three fail their checks: httpx, rich and typer. Five wait on a review from you."),
});

const REVIEWER: WorkflowStepInfo = step("reviewer", {
  kind: "agent",
  title: "reviewer",
  started_at: at(20, 40),
  finished_at: at(21, 30),
  child_session_id: "s_reviewer",
  result: raw("httpx: fine, the timeout default changed.\nrich: fine.\ntyper: check the CLI help text."),
});

const WORKER: WorkflowStepInfo = step("worker:typer", {
  kind: "agent",
  title: "worker · typer",
  started_at: at(20, 40),
  finished_at: at(21, 50),
  child_session_id: "s_worker_typer",
  result: { worktree: "wf-typer-1", diff: "a_diff_typer", files: [{ path: "typer/main.py" }, { path: "tests/test_main.py" }], added: 6, removed: 2, checks: "passed", checks_failed: [], checks_note: null },
});

const DRAFT = "Hi team,\n\nTwelve pull requests are open. httpx, rich and typer fail their checks. Please look at the five that wait on you before Friday.\n\nThanks, golem";

export const SAMPLE_REVIEW: WorkflowReviewInfo = { key: "review:Send this?", ask: "Send this digest?", draft: raw(DRAFT), created_at: at(21, 50), answered: false };

export const SAMPLE_TOOL_ASK: WorkflowReviewInfo = {
  key: "tool:gh_pr_create:1",
  ask: "Run gh_pr_create?",
  draft: { tool: "gh_pr_create", args: { title: "Bump typer to 0.13", base: "main", draft: true }, source: "your tool rules" },
  created_at: at(21, 50),
  answered: false,
};

const REVIEW_STEP = (status: WorkflowStepInfo["status"], extra: Partial<WorkflowStepInfo> = {}): WorkflowStepInfo =>
  step("review:Send this?", { kind: "review", title: "Send this digest?", status, started_at: at(21, 30), finished_at: null, ...extra });

export type WorkflowRunSample = { run: WorkflowRunInfo; steps: WorkflowStepInfo[]; reviews: WorkflowReviewInfo[] };

/** A run of each state the page draws: running, waiting on a review, waiting on a tool ask, failed, cancelled and done. */
export const SAMPLE_RUN_RUNNING: WorkflowRunSample = {
  run: run({ status: "running", finished_at: null, started_at: at(28) }),
  steps: [
    { ...LIST, started_at: at(28), finished_at: at(28, 3) },
    { ...SUMMARISE, started_at: at(28, 3), finished_at: at(28, 40) },
    step("reviewer", { kind: "agent", title: "reviewer", status: "running", started_at: at(28, 40), finished_at: null, child_session_id: "s_reviewer" }),
  ],
  reviews: [],
};

export const SAMPLE_RUN_REVIEW: WorkflowRunSample = {
  run: run({ status: "waiting", finished_at: null }),
  steps: [LIST, SUMMARISE, REVIEWER, REVIEW_STEP("waiting")],
  reviews: [SAMPLE_REVIEW],
};

export const SAMPLE_RUN_TOOL_ASK: WorkflowRunSample = {
  run: run({ status: "waiting", finished_at: null, name: "upgrade_dependencies" }),
  steps: [LIST, WORKER, step("tool:gh_pr_create:1", { kind: "tool", title: "gh_pr_create", status: "waiting", started_at: at(21, 50), finished_at: null })],
  reviews: [SAMPLE_TOOL_ASK],
};

export const SAMPLE_RUN_FAILED: WorkflowRunSample = {
  run: run({ status: "failed", finished_at: at(20, 30), error: "tool mcp__github__list_pull_requests: needs sign-in" }),
  steps: [step("list_prs", { kind: "tool", title: "list_pull_requests", status: "failed", started_at: at(20), finished_at: at(20, 30), error: "tool mcp__github__list_pull_requests: needs sign-in" })],
  reviews: [],
};

export const SAMPLE_RUN_CANCELLED: WorkflowRunSample = {
  run: run({ status: "cancelled", finished_at: at(21, 5) }),
  steps: [LIST, SUMMARISE, step("reviewer", { kind: "agent", title: "reviewer", status: "skipped", started_at: at(20, 40), finished_at: at(21, 5), child_session_id: "s_reviewer" })],
  reviews: [],
};

export const SAMPLE_RUN_DONE: WorkflowRunSample = {
  run: run({}),
  steps: [LIST, SUMMARISE, REVIEWER, WORKER, REVIEW_STEP("done", { finished_at: at(22), result: { verdict: "edit", text: "Hi team, twelve pull requests are open." } })],
  reviews: [],
};
