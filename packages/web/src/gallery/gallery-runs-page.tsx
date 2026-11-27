import { RunPane, RunsView } from "../features/runs/index.ts";
import { RUNS_NOW, SAMPLE_FILTER_RUNS, SAMPLE_FILTER_WORKFLOW, SAMPLE_MIXED_RUNS } from "../features/runs/sample.ts";
import { SAMPLE_FILE_READ, SAMPLE_RUN_DONE, SAMPLE_RUN_FAILED, SAMPLE_RUN_FILE, SAMPLE_RUN_RUNNING, SAMPLE_RUN_TEXT } from "../features/runs/workflow-sample.ts";

/** The result each sample run of the filtered page opens beside the list. */
const RESULTS = {
  wr_today: SAMPLE_RUN_TEXT,
  wr_empty: SAMPLE_RUN_DONE,
  wr_fail: SAMPLE_RUN_FAILED,
  wr_run: SAMPLE_RUN_RUNNING,
  wr_old: SAMPLE_RUN_FILE,
} as const;

function pane(id: string) {
  const sample = RESULTS[id as keyof typeof RESULTS];
  if (sample === undefined) return <p className="text-sm text-muted">This run has no result to show.</p>;
  return <RunPane key={id} run={{ ...sample.run, workflow_run_id: id }} steps={sample.steps} onReadOutput={() => Promise.resolve(SAMPLE_FILE_READ)} onNavigate={() => {}} />;
}

/** The Runs page: filtered to one workflow with its chip, a filter that matches nothing, every run, and a failed run open. */
export function RunsPageGallery({ theme }: { theme: string }) {
  const views = [
    ["Runs page, filtered to a workflow", { runs: SAMPLE_MIXED_RUNS, workflow: SAMPLE_FILTER_WORKFLOW }],
    ["Runs page, a failed run open", { runs: SAMPLE_FILTER_RUNS, workflow: SAMPLE_FILTER_WORKFLOW, initialSelected: "wr_fail" }],
    ["Runs page, nothing for the filter", { runs: SAMPLE_MIXED_RUNS.filter((run) => run.workflow_run_id == null), workflow: SAMPLE_FILTER_WORKFLOW }],
    ["Runs page, every run", { runs: SAMPLE_MIXED_RUNS }],
  ] as const;
  return (
    <>
      {views.map(([title, props]) => (
        <div key={title} className="mt-4 flex h-136 flex-col overflow-hidden rounded-lg border border-line bg-bg" role="region" aria-label={`${title}, ${theme}`}>
          <RunsView {...props} now={RUNS_NOW} onNavigate={() => {}} renderResult={pane} />
        </div>
      ))}
    </>
  );
}
