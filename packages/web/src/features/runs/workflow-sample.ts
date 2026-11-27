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
  title: "PR digest",
  description: "Tell the team which pull requests need them.",
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

/** One result of each kind, as the daemon would save it, for the gallery and the tests. */
export const SAMPLE_RESULTS: ReadonlyArray<readonly [string, unknown]> = [
  ["text", "# Morning briefing\n\n**3 things need you.** Device sync is failing.\n\n- Review the typer pull request\n- Look at the sync log"],
  ["record", { branch: "main", commits: 3, not_committed: 0, not_pushed: 2 }],
  [
    "table",
    [
      { message: "handler device.sync failed", level: "error", times: 4 },
      { message: "run r_8c41 failed", level: "error", times: 1 },
      { message: "GitHub Copilot MCP unreachable", level: "warning", times: 22 },
    ],
  ],
  ["file", "~/.golem/briefings/2026-11-27.md"],
  ["link", "https://github.com/golem/golem/pull/1921"],
  ["changes", { worktree: "wf-typer-1", diff: "a_diff_typer", files: [{ path: "typer/main.py" }], added: 6, removed: 2, checks: "passed", checks_failed: [], checks_note: null }],
  ["empty", []],
  ["other", [1, 2, 3]],
];

export const SAMPLE_RUN_DONE: WorkflowRunSample = {
  run: run({}),
  steps: [LIST, SUMMARISE, REVIEWER, WORKER, REVIEW_STEP("done", { finished_at: at(22), result: { verdict: "edit", text: "Hi team, twelve pull requests are open." } })],
  reviews: [],
};

const BRIEFING = "# Morning briefing\n\n**3 things need you.** Device sync is failing.\n\n- Review the typer pull request\n- Look at the sync log";

/** A finished run that marked one text result: the briefing, drawn as Markdown. */
export const SAMPLE_RUN_TEXT: WorkflowRunSample = {
  run: run({ title: "Morning briefing", description: "Tell me what needs me today.", summary: "3 things need you", outputs: [{ title: "Morning briefing", summary: "3 things need you", value: raw(BRIEFING) }] }),
  steps: [LIST, SUMMARISE],
  reviews: [],
};

export const SAMPLE_BRIEFING_PATH = "/Users/you/.golem/briefings/2026-11-27.md";

/** What `workflow.read_output` sends for the file of `SAMPLE_RUN_FILE`. */
export const SAMPLE_FILE_READ = { path: SAMPLE_BRIEFING_PATH, text: BRIEFING, truncated: false, size: BRIEFING.length };

/** The same, for a file that is longer than the daemon reads. */
export const SAMPLE_FILE_CUT = { ...SAMPLE_FILE_READ, truncated: true, size: 482_113 };

/** A finished run whose result is a file path: the page reads the file and shows it. */
export const SAMPLE_RUN_FILE: WorkflowRunSample = {
  run: run({ title: "Morning briefing", description: "Tell me what needs me today.", summary: "Saved as 2026-11-27.md", outputs: [{ title: "Briefing file", summary: "Saved as 2026-11-27.md", value: raw(SAMPLE_BRIEFING_PATH) }] }),
  steps: [LIST, SUMMARISE],
  reviews: [],
};

/** A finished run with several results: a text, a table and a link, one tab each. */
export const SAMPLE_RUN_OUTPUTS: WorkflowRunSample = {
  run: run({
    title: "Weekly report",
    description: "Collect the week into one report.",
    summary: "12 pull requests, 3 need you",
    outputs: [
      { title: "Report", summary: "12 pull requests", value: raw(BRIEFING) },
      { title: "Failing checks", value: raw(SAMPLE_RESULTS[2]![1]) },
      { title: "Pull request", value: raw("https://github.com/golem/golem/pull/1921") },
    ],
  }),
  steps: [LIST, SUMMARISE],
  reviews: [],
};

/** A run that read thirty feeds: one row, "Read each feed", with a count. Two items still work and one failed. */
export const SAMPLE_RUN_LOOP: WorkflowRunSample = {
  run: run({ status: "running", finished_at: null, title: "Read the news", description: "Read each feed and keep what is new.", started_at: at(28) }),
  steps: [
    { ...LIST, title: "List the feeds", started_at: at(28), finished_at: at(28, 1), result: raw("30 feeds") },
    ...Array.from({ length: 30 }, (_, i) =>
      step(`read:${i}`, {
        title: "Read each feed",
        item: `feed-${i + 1}.example.com`,
        status: i === 4 ? "failed" : i >= 27 ? "running" : "done",
        started_at: at(28, 2 + i),
        finished_at: i >= 27 ? null : at(28, 3 + i),
        error: i === 4 ? "the feed did not answer" : undefined,
        result: i >= 27 || i === 4 ? undefined : raw(`${(i % 5) + 1} new items`),
      }),
    ),
  ],
  reviews: [],
};
