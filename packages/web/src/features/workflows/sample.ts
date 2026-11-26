import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowEntryInfo, WorkflowGetResult, WorkflowListResult, WorkflowOutlineStep } from "../../store/workflows.ts";

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

export const SAMPLE_PR_DIGEST_GET: WorkflowGetResult = { workflow: SAMPLE_PR_DIGEST, steps: SAMPLE_PR_DIGEST_STEPS, code: SAMPLE_PR_DIGEST_CODE };

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
