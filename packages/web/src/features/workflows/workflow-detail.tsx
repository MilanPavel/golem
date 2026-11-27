import { useCallback, useState } from "react";
import { ADD_ROUTINE_WORDS, allRunsWords, checksWords, lastRunWords, routinePillWords } from "@golem/view";
import { routineNewPath, routinePath, runsPath, settingsPath } from "../../store/router.ts";
import type { RoutineInfo } from "../../store/routines.ts";
import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowCheckResult, WorkflowEntryInfo, WorkflowOutlineStep, WorkflowSaveResult } from "../../store/workflows.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { runHref } from "../runs/index.ts";
import { PendingButton } from "../routines/routine-detail.tsx";
import { RunDialog } from "./run-dialog.tsx";
import { WorkflowDot } from "./workflow-dot.tsx";
import { WorkflowEditor, type WorkflowEditorProps } from "./workflow-editor.tsx";
import { errorLine } from "./text.ts";

export type WorkflowDetailProps = {
  workflow: WorkflowEntryInfo;
  /** The outline steps read from the source, in file order. Empty for a broken or untrusted file. */
  steps: readonly WorkflowOutlineStep[];
  /** The text of the file, or null when it is not shown (a broken or untrusted file, or one that cannot be read). */
  code: string | null;
  /** This workflow's runs, newest first, for the Last run and All runs pills. */
  runs: readonly RunInfo[];
  /** The hash of `code`, which a save names as its base. Without it the code is read only. */
  codeHash?: string | null;
  /** Checks a text without writing it, for the editor. Without it the outline is not redrawn as you type. */
  onCheck?: (code: string) => Promise<WorkflowCheckResult>;
  /** Sets one argument of one step in a text, for the fields of the selected step. Without it, the fields are only shown. */
  onEditStep?: WorkflowEditorProps["onEditStep"];
  /** The agent types a step may name. */
  agents?: readonly string[];
  /** Writes the code. Rejects with the daemon's reason. Without it the code is read only. */
  onSave?: (code: string, baseHash: string) => Promise<WorkflowSaveResult>;
  /** Asks golem for a change to the code (workflow.propose). Without it, the ask box is not offered. */
  onPropose?: WorkflowEditorProps["onPropose"];
  /** The editor's state to start in. For the gallery and tests. */
  initialEditor?: WorkflowEditorProps["initial"];
  /** The routines whose `workflow` is this one, for the Routine pill. */
  routines?: readonly RoutineInfo[];
  now: number;
  onNavigate: (path: string) => void;
  /** Opens the file's folder in Finder. Without it, the action is not offered. */
  onReveal?: (path: string) => Promise<void>;
  /** Starts a run with these inputs and opens it. Rejects with the daemon's reason, which the Run… dialog shows. Without it, Run… is not offered. */
  onStart?: (inputs: Record<string, unknown>) => Promise<void>;
  /** Opens the folder dialog on the daemon's Mac. Without it, a folder input is typed. */
  onChooseFolder?: (start: string | null) => Promise<string | null>;
  /** Opens the Run… dialog at the start. For the gallery and tests. */
  initialRunOpen?: boolean;
};

const STATE_LINE: Record<WorkflowEntryInfo["state"], string> = {
  ok: "Ready",
  broken: "Broken: the file does not load",
  untrusted: "Not trusted: the project is not trusted, so the file is listed and never run",
};

function ErrorBox({ error }: { error: string }) {
  return (
    <div role="alert" className="flex max-h-40 shrink-0 flex-col gap-1.5 overflow-y-auto rounded-lg border border-deny bg-deny-soft p-3">
      <p className="text-sm font-medium text-deny">{errorLine(error)}</p>
      <pre className="overflow-x-auto font-mono text-code whitespace-pre-wrap text-ink">{error}</pre>
    </div>
  );
}

const PILL = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-meta text-muted";
const PILL_LINK = `${PILL} outline-offset-2 outline-clay hover:border-line-strong focus-visible:outline-2`;

function CodeTab({ workflow, steps, code, codeHash, onCheck, onSave, onPropose, onEditStep, agents, onOpenAgent, onReveal, onDirtyChange, onProblemsChange, initialEditor }: Pick<WorkflowDetailProps, "workflow" | "steps" | "code" | "codeHash" | "onCheck" | "onSave" | "onPropose" | "onEditStep" | "agents" | "onReveal" | "initialEditor"> & { onDirtyChange: (dirty: boolean) => void; onProblemsChange: (count: number | null) => void; onOpenAgent: (name: string) => void }) {
  if (code === null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="min-w-0 wrap-anywhere">
          <Code tone="muted">{workflow.path}</Code>
        </p>
        <p className="text-sm text-muted">{workflow.state === "ok" ? "The file could not be read." : "The code is not shown for a file that does not load or is not trusted."}</p>
      </div>
    );
  }
  return (
    <WorkflowEditor
      workflow={workflow}
      steps={steps}
      code={code}
      codeHash={codeHash ?? null}
      onCheck={onCheck}
      onSave={onSave}
      onPropose={onPropose}
      onEditStep={onEditStep}
      agents={agents}
      onOpenAgent={onOpenAgent}
      onReveal={onReveal}
      onDirtyChange={onDirtyChange}
      onProblemsChange={onProblemsChange}
      initial={initialEditor}
    />
  );
}

/** The Routine pill: one routine opens it, two or more list them, none offers a new one filled in with this workflow. */
function RoutinePill({ workflow, routines, now, onNavigate }: { workflow: WorkflowEntryInfo; routines: readonly RoutineInfo[]; now: number; onNavigate: (path: string) => void }) {
  const words = routinePillWords(routines, now);
  const [only, second] = routines;
  if (only === undefined) {
    return (
      <Link href={routineNewPath(null, workflow.id)} onNavigate={onNavigate} className={cn(PILL_LINK, "border-dashed")}>
        <span>
          <b className="font-medium text-ink">Not scheduled</b>
          {words.slice("Not scheduled".length)} · <span className="text-clay-ink underline underline-offset-2">{ADD_ROUTINE_WORDS}</span>
        </span>
      </Link>
    );
  }
  if (second === undefined) {
    return (
      <Link href={routinePath(only.config.name, only.folder)} onNavigate={onNavigate} className={PILL_LINK}>
        Routine <b className="font-medium text-ink">{words}</b>
        <span aria-hidden="true">→</span>
      </Link>
    );
  }
  return (
    <Popover>
      <PopoverTrigger className={cn(PILL_LINK, "cursor-pointer")}>
        <b className="font-medium text-ink">{words}</b>
        <span aria-hidden="true">▾</span>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto min-w-56 flex-col gap-1 p-2" align="start">
        <ul aria-label="Routines that start it" className="flex flex-col gap-0.5">
          {routines.map((routine) => (
            <li key={`${routine.config.name}/${routine.folder ?? ""}`}>
              <Link href={routinePath(routine.config.name, routine.folder)} onNavigate={onNavigate} className="flex flex-col rounded-md px-2 py-1.5 outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2">
                <span className="text-sm font-medium">{routine.config.name}</span>
                <span className="text-meta text-muted">{routinePillWords([routine], now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** The pills under the title: the routine, the last run, all the runs, and the checks. */
function Pills({ workflow, routines, runs, problems, now, onNavigate }: { workflow: WorkflowEntryInfo; routines: readonly RoutineInfo[]; runs: readonly RunInfo[]; problems: number | null; now: number; onNavigate: (path: string) => void }) {
  const last = runs[0];
  return (
    <div aria-label="About this workflow" role="group" className="flex flex-wrap items-center gap-2">
      <RoutinePill workflow={workflow} routines={routines} now={now} onNavigate={onNavigate} />
      {last === undefined ? (
        <span className={PILL}>
          Last run <b className="font-medium text-ink">never run</b>
        </span>
      ) : (
        <Link href={runHref(last)} onNavigate={onNavigate} className={PILL_LINK}>
          <span className={last.status === "failed" ? "text-deny" : undefined}>Last run</span> <b className={cn("font-medium", last.status === "failed" ? "text-deny" : "text-ink")}>{lastRunWords(last, now)}</b>
        </Link>
      )}
      {runs.length === 0 ? null : (
        <Link href={runsPath(workflow.id)} onNavigate={onNavigate} className={PILL_LINK}>
          {allRunsWords(runs.length)}
          <span aria-hidden="true">→</span>
        </Link>
      )}
      {problems === null ? null : (
        <span className={cn(PILL, problems === 0 ? "text-allow" : "text-deny")}>
          <span aria-hidden="true">{problems === 0 ? "✓" : "✕"}</span> {checksWords(problems)}
        </span>
      )}
    </div>
  );
}

/** The file's name without its folder. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** One workflow in the main area: its title, its pills, Run…, and the editor (Steps, Steps and code, Code). */
export function WorkflowDetail({ workflow, steps, code, runs, routines = [], codeHash, onCheck, onSave, onPropose, onEditStep, agents, initialEditor, now, onNavigate: navigateTo, onReveal, onStart, onChooseFolder, initialRunOpen = false }: WorkflowDetailProps) {
  const [runOpen, setRunOpen] = useState(initialRunOpen);
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<number | null>(initialEditor?.problems?.length ?? null);
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);
  const onProblemsChange = useCallback((next: number | null) => setProblems(next), []);
  // Leaving with code that is not saved asks first.
  const onNavigate = (path: string) => {
    if (dirty && !window.confirm("The code has changes that are not saved. Leave and lose them?")) return;
    navigateTo(path);
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <header className="flex shrink-0 flex-wrap-reverse items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
          <h1 className="flex items-center gap-2 font-ui text-lg font-semibold">
            <WorkflowDot state={workflow.state} />
            <span className="min-w-0 truncate">{workflow.title ?? workflow.name}</span>
            <Code tone="muted" className="shrink-0 font-normal">{fileName(workflow.path)}</Code>
            {workflow.project === null || workflow.project === undefined ? null : <Badge>project</Badge>}
          </h1>
          <p className="text-meta text-muted">{STATE_LINE[workflow.state]}</p>
          {workflow.description ? (
            <p title={workflow.description} className="truncate text-meta text-muted">
              {workflow.description}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workflow.state === "ok" && onStart !== undefined ? (
            <Button kind="primary" size="sm" onClick={() => setRunOpen(true)}>
              Run…
            </Button>
          ) : workflow.state === "ok" ? (
            <PendingButton kind="primary" reason="Not available here">
              Run…
            </PendingButton>
          ) : (
            <PendingButton kind="primary" reason="A workflow that does not load cannot run">
              Run…
            </PendingButton>
          )}
        </div>
      </header>
      <Pills workflow={workflow} routines={routines} runs={runs} problems={problems} now={now} onNavigate={onNavigate} />
      {onStart === undefined ? null : <RunDialog open={runOpen} workflow={workflow}
          onStart={async (inputs) => {
            await onStart(inputs);
            setRunOpen(false);
          }}
          onCancel={() => setRunOpen(false)} onChooseFolder={onChooseFolder} />}
      {workflow.state === "broken" && workflow.error ? <ErrorBox error={workflow.error} /> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CodeTab workflow={workflow} steps={steps} code={code} codeHash={codeHash} onCheck={onCheck} onSave={onSave} onPropose={onPropose} onEditStep={onEditStep} agents={agents} onOpenAgent={() => onNavigate(settingsPath("agents"))} onReveal={onReveal} onDirtyChange={onDirtyChange} onProblemsChange={onProblemsChange} initialEditor={initialEditor} />
      </div>
    </div>
  );
}
