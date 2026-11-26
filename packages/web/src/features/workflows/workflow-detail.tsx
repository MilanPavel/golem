import { useCallback, useState, type ReactNode } from "react";
import { nextRunText, routineState, triggerWords } from "@golem/view";
import { routineNewPath, routinePath } from "../../store/router.ts";
import type { RoutineInfo } from "../../store/routines.ts";
import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowCheckResult, WorkflowEntryInfo, WorkflowOutlineStep, WorkflowSaveResult } from "../../store/workflows.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Link } from "../../ui/link.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { RunRow } from "../runs/index.ts";
import { PendingButton } from "../routines/routine-detail.tsx";
import { RoutineDot } from "../routines/routine-dot.tsx";
import { RunDialog } from "./run-dialog.tsx";
import { WorkflowDot } from "./workflow-dot.tsx";
import { WorkflowEditor, type WorkflowEditorProps } from "./workflow-editor.tsx";
import { errorLine, stepNotes, stepStart, triggerText } from "./text.ts";

export type WorkflowDetailProps = {
  workflow: WorkflowEntryInfo;
  /** The outline steps read from the source, in file order. Empty for a broken or untrusted file. */
  steps: readonly WorkflowOutlineStep[];
  /** The text of the file, or null when it is not shown (a broken or untrusted file, or one that cannot be read). */
  code: string | null;
  /** This workflow's runs, newest first. */
  runs: readonly RunInfo[];
  /** The hash of `code`, which a save names as its base. Without it the code is read only. */
  codeHash?: string | null;
  /** Checks a text without writing it, for the editor. Without it the outline is not redrawn as you type. */
  onCheck?: (code: string) => Promise<WorkflowCheckResult>;
  /** Writes the code. Rejects with the daemon's reason. Without it the code is read only. */
  onSave?: (code: string, baseHash: string) => Promise<WorkflowSaveResult>;
  /** The editor's state to start in. For the gallery and tests. */
  initialEditor?: WorkflowEditorProps["initial"];
  /** The routines whose `workflow` is this one, for the Triggers tab. */
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
  /** The tab shown first. The Overview by default. */
  initialTab?: "overview" | "code" | "runs" | "triggers";
};

type Tab = "overview" | "code" | "runs" | "triggers";

const STATE_LINE: Record<WorkflowEntryInfo["state"], string> = {
  ok: "Ready",
  broken: "Broken: the file does not load",
  untrusted: "Not trusted: the project is not trusted, so the file is listed and never run",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-meta font-medium text-faint">{title}</h2>
      {children}
    </section>
  );
}

function InputsTable({ workflow }: { workflow: WorkflowEntryInfo }) {
  if (workflow.inputs === undefined || workflow.inputs.length === 0) return <p className="text-sm text-muted">No inputs.</p>;
  return (
    <table className="w-full max-w-2xl border-collapse text-sm">
      <caption className="sr-only">Inputs</caption>
      <thead>
        <tr className="border-b border-line text-left text-meta text-faint">
          <th scope="col" className="py-1.5 pr-3 font-normal">
            Name
          </th>
          <th scope="col" className="py-1.5 pr-3 font-normal">
            Type
          </th>
          <th scope="col" className="py-1.5 font-normal">
            Default
          </th>
        </tr>
      </thead>
      <tbody>
        {workflow.inputs.map((input) => (
          <tr key={input.name} className="border-b border-line last:border-b-0">
            <td className="py-1.5 pr-3">
              <Code>{input.name}</Code>
            </td>
            <td className="py-1.5 pr-3">{input.type ? <Code tone="muted">{input.type}</Code> : <span className="text-muted">any</span>}</td>
            <td className="py-1.5">{input.default ? <Code tone="muted">{input.default}</Code> : <span className="text-muted">required</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StepsOutline({ steps }: { steps: readonly WorkflowOutlineStep[] }) {
  if (steps.length === 0) return <p className="text-sm text-muted">No steps found in the file.</p>;
  return (
    <ol aria-label="Steps" className="flex max-w-2xl flex-col divide-y divide-line rounded-lg border border-line bg-surface">
      {steps.map((step, at) => {
        const line = stepStart(step);
        return (
          <li key={step.id} className="flex items-baseline gap-3 px-3 py-2">
            <span className="w-5 shrink-0 text-right text-meta text-faint">{at + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{step.title}</span>
              <span className="text-meta text-muted wrap-anywhere">{stepNotes(step).join(" · ")}</span>
            </span>
            {line === null ? null : <span className="shrink-0 text-meta text-faint">line {line}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function ErrorBox({ error }: { error: string }) {
  return (
    <div role="alert" className="flex flex-col gap-1.5 rounded-lg border border-deny bg-deny-soft p-3">
      <p className="text-sm font-medium text-deny">{errorLine(error)}</p>
      <pre className="overflow-x-auto font-mono text-code whitespace-pre-wrap text-ink">{error}</pre>
    </div>
  );
}

function Overview({ workflow, steps }: { workflow: WorkflowEntryInfo; steps: readonly WorkflowOutlineStep[] }) {
  return (
    <div className="flex flex-col gap-5">
      <Section title="What it does">
        <p className="max-w-2xl text-sm text-pretty">{!workflow.description ? <span className="text-muted">No description.</span> : workflow.description}</p>
      </Section>
      <Section title="Inputs">
        <InputsTable workflow={workflow} />
      </Section>
      <Section title="Steps">
        <StepsOutline steps={steps} />
      </Section>
      <Section title="Starts">
        <p className="text-sm">{triggerText(workflow.trigger)}</p>
      </Section>
    </div>
  );
}

function CodeTab({ workflow, steps, code, codeHash, onCheck, onSave, onReveal, onDirtyChange, initialEditor }: Pick<WorkflowDetailProps, "workflow" | "steps" | "code" | "codeHash" | "onCheck" | "onSave" | "onReveal" | "initialEditor"> & { onDirtyChange: (dirty: boolean) => void }) {
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
      onReveal={onReveal}
      onDirtyChange={onDirtyChange}
      initial={initialEditor}
    />
  );
}

function RunsTab({ runs, now, onNavigate }: Pick<WorkflowDetailProps, "runs" | "now" | "onNavigate">) {
  if (runs.length === 0) return <p className="text-sm text-muted">No runs yet.</p>;
  return (
    <ul aria-label="Runs" className="flex max-w-4xl flex-col gap-0.5">
      {runs.map((run) => (
        <RunRow key={run.session_id} run={run} now={now} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

const LINK = "text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2";

/** The inputs a routine gives the workflow: `repo=MilanPavel/golem, since=1d`. Empty for none. */
function inputsText(routine: RoutineInfo): string {
  return Object.entries(routine.config.inputs ?? {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

function TriggersTab({ routines, now, onNavigate }: { routines: readonly RoutineInfo[]; now: number; onNavigate: (path: string) => void }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm text-muted">Everything that can start this workflow. A workflow has no trigger of its own; routines hold the &quot;when&quot;, so this tab lists the routines that point here.</p>
      <Section title="Routines that start it">
        {routines.length === 0 ? (
          <p className="text-sm text-muted">
            No routine starts this workflow. Make one in{" "}
            <Link href={routineNewPath()} onNavigate={onNavigate} className={LINK}>
              Routines
            </Link>
            : choose &quot;A workflow&quot; under Run, then pick this one.
          </p>
        ) : (
          <ul aria-label="Routines that start it" className="flex flex-col gap-2">
            {routines.map((routine) => {
              const inputs = inputsText(routine);
              return (
                <li key={`${routine.config.name}/${routine.folder ?? ""}`} className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <RoutineDot state={routineState(routine)} />
                    <span className="min-w-0 truncate text-sm font-medium">{routine.config.name}</span>
                    <span className="text-meta text-faint">{routine.config.enabled === false ? "off" : nextRunText(routine.next_at, now)}</span>
                    <Link href={routinePath(routine.config.name, routine.folder)} onNavigate={onNavigate} className={`ml-auto shrink-0 whitespace-nowrap text-sm ${LINK}`}>
                      Open routine<span aria-hidden="true"> ›</span>
                    </Link>
                  </div>
                  <p className="pl-5.5 text-meta text-muted wrap-anywhere">{[triggerWords(routine.config), inputs].filter((part) => part !== "").join(" · ")}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** One workflow in the main area: its state, Run…, and the Overview, Code, Runs and Triggers tabs. */
export function WorkflowDetail({ workflow, steps, code, runs, routines = [], codeHash, onCheck, onSave, initialEditor, now, onNavigate: navigateTo, onReveal, onStart, onChooseFolder, initialRunOpen = false, initialTab = "overview" }: WorkflowDetailProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [runOpen, setRunOpen] = useState(initialRunOpen);
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);
  // Leaving with code that is not saved asks first.
  const onNavigate = (path: string) => {
    if (dirty && !window.confirm("The code has changes that are not saved. Leave and lose them?")) return;
    navigateTo(path);
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap-reverse items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
          <h1 className="flex items-center gap-2 font-ui text-lg font-semibold">
            <WorkflowDot state={workflow.state} />
            <span className="min-w-0 truncate">{workflow.name}</span>
            {workflow.project === null || workflow.project === undefined ? null : <Badge>project</Badge>}
          </h1>
          <p className="text-meta text-muted">{STATE_LINE[workflow.state]}</p>
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
      {onStart === undefined ? null : <RunDialog open={runOpen} workflow={workflow}
          onStart={async (inputs) => {
            await onStart(inputs);
            setRunOpen(false);
          }}
          onCancel={() => setRunOpen(false)} onChooseFolder={onChooseFolder} />}
      {workflow.state === "broken" && workflow.error ? <ErrorBox error={workflow.error} /> : null}
      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="flex flex-col gap-4">
        <TabsList aria-label={`${workflow.name} details`}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview workflow={workflow} steps={steps} />
        </TabsContent>
        {/* Kept mounted, so an edit survives a look at another tab. */}
        <TabsContent value="code" forceMount hidden={tab !== "code"}>
          <CodeTab workflow={workflow} steps={steps} code={code} codeHash={codeHash} onCheck={onCheck} onSave={onSave} onReveal={onReveal} onDirtyChange={onDirtyChange} initialEditor={initialEditor} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab runs={runs} now={now} onNavigate={onNavigate} />
        </TabsContent>
        <TabsContent value="triggers">
          <TriggersTab routines={routines} now={now} onNavigate={onNavigate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
