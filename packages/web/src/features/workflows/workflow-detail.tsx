import { useCallback, useState, type ReactNode } from "react";
import { nextRunText, routineState, triggerWords } from "@golem/view";
import { routineNewPath, routinePath, settingsPath } from "../../store/router.ts";
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
import { errorLine, triggerText } from "./text.ts";

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
  /** The tab shown first. The Code by default. */
  initialTab?: "code" | "runs" | "triggers";
};

type Tab = "code" | "runs" | "triggers";

/** A tab body: the header and the tab list stay put and this scrolls. The Code tab fills it from lg up and scrolls inside its columns. */
const BODY = "min-h-0 flex-1 overflow-y-auto";

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

function ErrorBox({ error }: { error: string }) {
  return (
    <div role="alert" className="flex max-h-40 shrink-0 flex-col gap-1.5 overflow-y-auto rounded-lg border border-deny bg-deny-soft p-3">
      <p className="text-sm font-medium text-deny">{errorLine(error)}</p>
      <pre className="overflow-x-auto font-mono text-code whitespace-pre-wrap text-ink">{error}</pre>
    </div>
  );
}

const LINK = "text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2";

function CodeTab({ workflow, steps, code, codeHash, onCheck, onSave, onPropose, onEditStep, agents, onOpenAgent, onReveal, onDirtyChange, initialEditor }: Pick<WorkflowDetailProps, "workflow" | "steps" | "code" | "codeHash" | "onCheck" | "onSave" | "onPropose" | "onEditStep" | "agents" | "onReveal" | "initialEditor"> & { onDirtyChange: (dirty: boolean) => void; onOpenAgent: (name: string) => void }) {
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

/** The inputs a routine gives the workflow: `repo=MilanPavel/golem, since=1d`. Empty for none. */
function inputsText(routine: RoutineInfo): string {
  return Object.entries(routine.config.inputs ?? {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

function TriggersTab({ workflow, routines, now, onNavigate }: { workflow: WorkflowEntryInfo; routines: readonly RoutineInfo[]; now: number; onNavigate: (path: string) => void }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm text-muted">Everything that can start this workflow. A workflow has no trigger of its own; routines hold the &quot;when&quot;, so this tab lists the routines that point here.</p>
      <p className="text-sm">Starts: {triggerText(workflow.trigger)}</p>
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

/** One workflow in the main area: its state, Run…, and the Code, Runs and Triggers tabs. */
export function WorkflowDetail({ workflow, steps, code, runs, routines = [], codeHash, onCheck, onSave, onPropose, onEditStep, agents, initialEditor, now, onNavigate: navigateTo, onReveal, onStart, onChooseFolder, initialRunOpen = false, initialTab = "code" }: WorkflowDetailProps) {
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <header className="flex shrink-0 flex-wrap-reverse items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
          <h1 className="flex items-center gap-2 font-ui text-lg font-semibold">
            <WorkflowDot state={workflow.state} />
            <span className="min-w-0 truncate">{workflow.name}</span>
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
      {onStart === undefined ? null : <RunDialog open={runOpen} workflow={workflow}
          onStart={async (inputs) => {
            await onStart(inputs);
            setRunOpen(false);
          }}
          onCancel={() => setRunOpen(false)} onChooseFolder={onChooseFolder} />}
      {workflow.state === "broken" && workflow.error ? <ErrorBox error={workflow.error} /> : null}
      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList className="shrink-0" aria-label={`${workflow.name} details`}>
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
        </TabsList>
        {/* Kept mounted, so an edit survives a look at another tab. */}
        <TabsContent value="code" forceMount hidden={tab !== "code"} className={BODY}>
          <CodeTab workflow={workflow} steps={steps} code={code} codeHash={codeHash} onCheck={onCheck} onSave={onSave} onPropose={onPropose} onEditStep={onEditStep} agents={agents} onOpenAgent={() => onNavigate(settingsPath("agents"))} onReveal={onReveal} onDirtyChange={onDirtyChange} initialEditor={initialEditor} />
        </TabsContent>
        <TabsContent value="runs" className={BODY}>
          <RunsTab runs={runs} now={now} onNavigate={onNavigate} />
        </TabsContent>
        <TabsContent value="triggers" className={BODY}>
          <TriggersTab workflow={workflow} routines={routines} now={now} onNavigate={onNavigate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
