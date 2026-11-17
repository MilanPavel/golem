/** The automation roadmap: Phase 4, issue #85. */
export const AUTOMATION_ROADMAP = "https://github.com/MilanPavel/golem/issues/85";

/** The body of a panel that is not built yet: what it is called, what it will be, and where the plan is. No data. */
function InProgress({ title, line }: { title: string; line: string }) {
  return (
    <div className="flex flex-col gap-2 px-2 py-3 text-sm">
      <p className="font-medium">{title} are in progress</p>
      <p className="text-pretty text-muted">{line}</p>
      <a
        href={AUTOMATION_ROADMAP}
        target="_blank"
        rel="noreferrer"
        className="w-fit text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2"
      >
        Roadmap: Phase 4 (#85)
      </a>
    </div>
  );
}

export const WorkflowsInProgress = () => (
  <InProgress title="Workflows" line="A workflow will chain steps that run one after another, each with its own model and tools." />
);

export const RunsInProgress = () => (
  <InProgress title="Runs" line="Runs will list what routines and workflows did, with the outcome of each." />
);
