import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowEntryInfo, WorkflowGetResult, WorkflowListResult, WorkflowOutlineStep, WorkflowProblem, WorkflowProposeResult } from "../../store/workflows.ts";

/** "Now" for the samples: a Tuesday evening. Run times are placed relative to it, so Today and Earlier hold in any time zone. */
export const WORKFLOWS_NOW = new Date(2026, 10, 17, 18, 30).getTime();

const at = (daysBack: number, hour: number, minute: number, second = 0): string => new Date(2026, 10, 17 - daysBack, hour, minute, second).toISOString();

export const SAMPLE_PR_DIGEST: WorkflowEntryInfo = {
  id: "/Users/you/.golem/workflows/pr_digest.py::pr_digest",
  name: "pr_digest",
  path: "/Users/you/.golem/workflows/pr_digest.py",
  project: null,
  state: "ok",
  trigger: { kind: "manual" },
  inputs: [
    { name: "tool", type: "str" },
    { name: "repo", type: "str" },
    { name: "since", type: "str", default: '"1d"' },
  ],
  description: "One line for each open pull request, checked by you, then a notice.",
};

export const SAMPLE_PR_DIGEST_CODE = `import json

from golem.workflow import Run, manual, workflow


@workflow(
    trigger=manual(),
    inputs={"tool": str, "repo": str},
    description="One line for each open pull request, checked by you, then a notice.",
)
async def pr_digest(run: Run) -> str:
    listing = await run.tool(run.inputs["tool"], repo=run.inputs["repo"])
    pulls = json.loads(listing)

    lines = await run.parallel(
        [run.llm(f"Summarise this pull request in one line:\\n{json.dumps(pr)}", key=f"summarise #{i}") for i, pr in enumerate(pulls)]
    )
    digest = "\\n".join(f"- {line}" for line in lines)

    reviewed = await run.review(digest, ask="Digest of open PRs")
    if reviewed["verdict"] == "reject":
        return "rejected"
    await run.notify(digest, title="PR digest")
    return digest
`;

const step = (id: string, kind: string, title: string, first: number, last: number, extra: Partial<WorkflowOutlineStep> = {}): WorkflowOutlineStep => ({
  id,
  kind,
  title,
  lines: [first, last],
  ...extra,
});

export const SAMPLE_PR_DIGEST_STEPS: WorkflowOutlineStep[] = [
  step("s1", "tool", "List the pull requests", 12, 12),
  step("s2", "llm", "Summarise each pull request", 15, 17, { for_each: "pulls" }),
  step("s3", "review", "Check the digest", 20, 20),
  step("s4", "notify", "Tell you", 23, 23, { condition: 'reviewed["verdict"] != "reject"' }),
];

/** The hash `workflow.get` gave for the sample code. */
export const SAMPLE_PR_DIGEST_HASH = "9f2c1ab04e7d";

export const SAMPLE_PR_DIGEST_GET: WorkflowGetResult = { workflow: SAMPLE_PR_DIGEST, steps: SAMPLE_PR_DIGEST_STEPS, code: SAMPLE_PR_DIGEST_CODE, code_hash: SAMPLE_PR_DIGEST_HASH };

/** The sample code with its review step cut out, as after an edit that is not saved. */
export const SAMPLE_PR_DIGEST_EDITED_CODE = SAMPLE_PR_DIGEST_CODE.replace('    reviewed = await run.review(digest, ask="Digest of open PRs")\n', "");

/** The outline `workflow.check` gives for the edited code: the review step is gone, and the notice moved up a line. */
export const SAMPLE_PR_DIGEST_EDITED_STEPS: WorkflowOutlineStep[] = [
  SAMPLE_PR_DIGEST_STEPS[0]!,
  SAMPLE_PR_DIGEST_STEPS[1]!,
  step("s4", "notify", "Tell you", 22, 22, { condition: 'reviewed["verdict"] != "reject"' }),
];

/** What `workflow.check` finds in a text with a budget that is not text, an unknown agent, and a paid model in a local-only folder. */
export const SAMPLE_PR_DIGEST_PROBLEMS: WorkflowProblem[] = [
  { line: 12, severity: "error", message: 'budget takes money as text, like "$0.50".', step_id: "s1", fix: '"$0.50"' },
  { line: 15, severity: "error", message: 'no agent "upgrader". Known: explorer, worker, reviewer, advisor.', step_id: "s2", fix: "worker" },
  { line: 16, severity: "warning", message: "claude-opus is paid, and this folder is local-only (Settings › Routing). A run would stop at this step.", step_id: "s2" },
];

/** What golem proposes for "leave out draft pull requests, and summarise on a cheap model": a new code step, and the summary step with a budget. */
export const SAMPLE_PR_DIGEST_PROPOSED_CODE = SAMPLE_PR_DIGEST_CODE.replace("    pulls = json.loads(listing)\n", '    pulls = json.loads(listing)\n    pulls = await run.step("Leave out drafts", lambda: [pr for pr in pulls if not pr.get("draft")])\n').replace("key=f\"summarise #{i}\")", 'key=f"summarise #{i}", budget="$0.10")');

export const SAMPLE_PR_DIGEST_PROPOSAL: WorkflowProposeResult = {
  code: SAMPLE_PR_DIGEST_PROPOSED_CODE,
  note: "I added a step that leaves draft pull requests out before they are summarised, and capped each summary at ten cents.",
  steps: [
    SAMPLE_PR_DIGEST_STEPS[0]!,
    step("s2", "code", "Leave out drafts", 14, 14),
    step("s3", "llm", "Summarise each pull request", 16, 18, { for_each: "pulls", budget: "$0.10" }),
    step("s4", "review", "Check the digest", 21, 21),
    step("s5", "notify", "Tell you", 24, 24, { condition: 'reviewed["verdict"] != "reject"' }),
  ],
  problems: [],
  model: "ollama/qwen3:14b",
};

/** The same proposal with a step that names an agent the folder does not have. */
export const SAMPLE_PR_DIGEST_PROPOSAL_PROBLEM: WorkflowProposeResult = {
  ...SAMPLE_PR_DIGEST_PROPOSAL,
  problems: [{ line: 14, severity: "error", message: 'no agent "upgrader". Known: explorer, worker, reviewer, advisor.', step_id: "s2", fix: "worker" }],
};

/** What `workflow.save` says when the file was written by something else since the editor opened it. */
export const SAMPLE_SAVE_CONFLICT = "The file changed on disk since you opened it. Copy your changes, then reload the workflow.";

export const SAMPLE_HELLO: WorkflowEntryInfo = {
  id: "/Users/you/repos/site/.golem/workflows/hello.py::hello",
  name: "hello",
  path: "/Users/you/repos/site/.golem/workflows/hello.py",
  project: "/Users/you/repos/site",
  state: "ok",
  trigger: null,
  inputs: [],
  description: "",
};

export const SAMPLE_NIGHTLY: WorkflowEntryInfo = {
  id: "/Users/you/repos/site/.golem/workflows/nightly.py::nightly",
  name: "nightly",
  path: "/Users/you/repos/site/.golem/workflows/nightly.py",
  project: "/Users/you/repos/site",
  state: "ok",
  trigger: { kind: "schedule", expr: "0 2 * * *" },
  inputs: [{ name: "branch", type: "str", default: '"main"' }],
  description: "Run the checks on the main branch and report what failed.",
};

export const SAMPLE_BROKEN_ERROR = `Traceback (most recent call last):
  File "/Users/you/.golem/workflows/broken.py", line 7, in <module>
    from golem.workflow import Runn
ImportError: cannot import name 'Runn' from 'golem.workflow'`;

export const SAMPLE_BROKEN: WorkflowEntryInfo = {
  id: "/Users/you/.golem/workflows/broken.py",
  name: "broken",
  path: "/Users/you/.golem/workflows/broken.py",
  project: null,
  state: "broken",
  error: SAMPLE_BROKEN_ERROR,
  trigger: null,
  inputs: [],
  description: "",
};

export const SAMPLE_UNTRUSTED: WorkflowEntryInfo = {
  id: "/Users/you/repos/other/.golem/workflows/deploy.py::deploy",
  name: "deploy",
  path: "/Users/you/repos/other/.golem/workflows/deploy.py",
  project: "/Users/you/repos/other",
  state: "untrusted",
  trigger: null,
  inputs: [],
  description: "",
};

export const SAMPLE_WORKFLOW_LIST: WorkflowListResult = { workflows: [SAMPLE_NIGHTLY, SAMPLE_HELLO, SAMPLE_PR_DIGEST, SAMPLE_BROKEN] };

/** The same list with a second project, whose folder is not trusted. */
export const SAMPLE_WORKFLOW_LIST_TWO_PROJECTS: WorkflowListResult = { workflows: [SAMPLE_NIGHTLY, SAMPLE_UNTRUSTED, SAMPLE_PR_DIGEST] };

const run = (id: string, extra: Partial<RunInfo>): RunInfo => ({
  session_id: id,
  kind: "workflow",
  origin: "workflow:pr_digest",
  status: "succeeded",
  approvals: 0,
  steps: 4,
  ...extra,
});

/** Runs of `pr_digest` in the Runs list: one waiting for its review, one failed, two done. */
export const SAMPLE_WORKFLOW_RUNS: RunInfo[] = [
  run("w_wait", { status: "waiting", started_at: at(0, 17, 40), approvals: 1, summary: "Check the digest" }),
  run("w_ok", { started_at: at(0, 9, 5), ended_at: at(0, 9, 6, 12), summary: "12 pull requests" }),
  run("w_fail", { status: "failed", started_at: at(1, 9, 0), ended_at: at(1, 9, 0, 21), reason: "tool mcp__github__list_pull_requests: needs sign-in" }),
  run("w_old", { started_at: at(3, 9, 0), ended_at: at(3, 9, 1, 2), summary: "9 pull requests" }),
];

/** A run of `pr_digest` that the routine `weekday-pr-digest` started: a routine row (it has a routine run id and a trigger) whose session is a workflow's. */
export const SAMPLE_ROUTINE_WORKFLOW_RUN: RunInfo = run("w_routine", {
  kind: "routine",
  routine: "weekday-pr-digest",
  routine_run_id: "rr_20",
  trigger: "schedule",
  started_at: at(0, 9, 0),
  ended_at: at(0, 9, 1, 8),
  summary: "12 pull requests",
});
