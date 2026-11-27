import { useId, useRef, useState } from "react";
import {
  CREATE_WORDS,
  DESCRIBE_HELP,
  DESCRIBE_TITLE,
  DESCRIBE_TRIES,
  EMPTY_FILE_HELP,
  EMPTY_FILE_TITLE,
  FROM_CHAT_HELP,
  FROM_CHAT_TITLE,
  NEW_WORKFLOW_INTRO,
  NEW_WORKFLOW_TITLE,
  NEXT_STEPS,
  SCHEDULE_ASK_HELP,
  SCHEDULE_ASK_TITLE,
  SCHEDULE_NO_WORDS,
  SCHEDULE_YES_WORDS,
  STARTERS_HELP,
  STARTERS_TITLE,
  WRITE_STEPS_WORDS,
  describeModelWords,
  nameTakenWords,
  saveInWords,
  suggestFreeName,
  workflowFileName,
} from "@golem/view";
import { actionErrorText } from "../../store/errors.ts";
import { routineNewPath, workflowPath } from "../../store/router.ts";
import type { WorkflowCheckResult, WorkflowCreateResult, WorkflowDraftResult, WorkflowEditStepResult, WorkflowEntryInfo, WorkflowModelInfo, WorkflowOutlineStep, WorkflowProblem, WorkflowSaveResult, WorkflowStarterInfo } from "../../store/workflows.ts";
import { Button } from "../../ui/button.tsx";
import { Card } from "../../ui/card.tsx";
import { Code } from "../../ui/code.tsx";
import { fieldClass, Input } from "../../ui/input.tsx";
import { Link } from "../../ui/link.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { cn } from "../../ui/cn.ts";
import { WorkflowEditor } from "./workflow-editor.tsx";
import { StarterCard, type AddStarter } from "./workflows-empty.tsx";

/** Where the new file goes: your own folder, or the workflows folder of the project you are in. */
export type SaveWhere = "yours" | "project";

/** What the page holds once there is text to edit: a draft not saved yet, or a file that was created. */
export type NewSession = {
  /** The text in the editor to start with. */
  code: string;
  steps: readonly WorkflowOutlineStep[];
  problems: readonly WorkflowProblem[];
  workflowModel: WorkflowModelInfo | null;
  /** golem's note on what the steps do, and the model that wrote them. Empty for a file that was created from the skeleton. */
  note: string;
  writtenBy: string | null;
  /** The file's base name and the title, from the typed name. */
  file: string;
  title: string;
  /** Where the file goes (or went), for the path shown before it exists. */
  where: SaveWhere;
  /** The hash of the text on disk: set once the file exists. */
  hash: string | null;
  /** The workflow as loaded, once the file exists. */
  made: WorkflowEntryInfo | null;
  view: "both" | "code";
};

export type WorkflowNewProps = {
  /** The starters golem ships. */
  starters: readonly WorkflowStarterInfo[];
  /** Every workflow listed, to say a taken name before it is sent. */
  workflows: readonly WorkflowEntryInfo[];
  /** The project folder a new session would start in, or null. The "This project" place needs it. */
  folder: string | null;
  /** The names of the models you have set up. */
  models: readonly string[];
  /** The model golem's default is now, or null when none is set up. */
  defaultModel: string | null;
  /** The agent types a step may name. */
  agents?: readonly string[];
  onAddStarter: AddStarter;
  /** Asks golem to write a workflow from a few sentences (workflow.draft). Rejects with the daemon's reason. */
  onDraft: (name: string, ask: string, folder: string | null, model: string | null) => Promise<WorkflowDraftResult>;
  /** Writes a new file (workflow.create): `code` null is the skeleton. Rejects with the daemon's reason. */
  onCreate: (name: string, folder: string | null, code: string | null) => Promise<WorkflowCreateResult>;
  /** The editor's calls on the file once it exists. */
  onSave: (id: string, code: string, baseHash: string) => Promise<WorkflowSaveResult>;
  onCheck?: (id: string, code: string) => Promise<WorkflowCheckResult>;
  onEditStep?: (id: string, code: string, stepId: string, name: string, value: string | null) => Promise<WorkflowEditStepResult>;
  onNavigate: (path: string) => void;
  /** A state to start in, for the gallery and tests. */
  initial?: { name?: string; ask?: string; where?: SaveWhere; model?: string; session?: NewSession; scheduleOpen?: boolean; draftError?: string; createError?: string; nameError?: string };
};

function pathOf(where: SaveWhere, folder: string | null, file: string): string {
  return where === "project" && folder !== null ? `${folder}/workflows/${file}.py` : `~/.golem/workflows/${file}.py`;
}

/** The names a new file would clash with in the chosen place: each workflow's name and its file's base name. */
function namesIn(workflows: readonly WorkflowEntryInfo[], where: SaveWhere, folder: string | null): string[] {
  return workflows
    .filter((workflow) => (where === "project" ? workflow.project === folder : workflow.project === undefined || workflow.project === null))
    .flatMap((workflow) => [workflow.name, workflow.path.slice(workflow.path.lastIndexOf("/") + 1).replace(/\.py$/, "")]);
}

function Label({ id, children }: { id: string; children: string }) {
  return (
    <label htmlFor={id} className="text-xs font-medium text-muted">
      {children}
    </label>
  );
}

/** The question after a file is made: a routine, filled in with this workflow, or not now. */
function ScheduleAsk({ id, onNavigate, onClose }: { id: string; onNavigate: (path: string) => void; onClose: () => void }) {
  return (
    <section aria-label={SCHEDULE_ASK_TITLE} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-allow bg-allow-soft px-3 py-2">
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
        <h2 className="text-sm font-semibold">{SCHEDULE_ASK_TITLE}</h2>
        <p className="text-meta text-muted">{SCHEDULE_ASK_HELP}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button kind="primary" size="sm" onClick={() => onNavigate(routineNewPath(null, id))}>
          {SCHEDULE_YES_WORDS}
        </Button>
        <Link href={workflowPath(id)} onNavigate={onNavigate} className="text-sm text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2">
          Open the workflow page
        </Link>
        <Button size="sm" onClick={onClose}>
          {SCHEDULE_NO_WORDS}
        </Button>
      </div>
    </section>
  );
}

/** The editor with the new text in it: a draft nobody saved, or the file that was just created. */
function NewEditor({ session, folder, models, agents, onCreate, onSave, onCheck, onEditStep, onBack, onNavigate, initialScheduleOpen }: { session: NewSession; folder: string | null; models: readonly string[]; agents?: readonly string[]; onCreate: WorkflowNewProps["onCreate"]; onSave: WorkflowNewProps["onSave"]; onCheck: WorkflowNewProps["onCheck"]; onEditStep: WorkflowNewProps["onEditStep"]; onBack: () => void; onNavigate: (path: string) => void; initialScheduleOpen: boolean }) {
  const [made, setMade] = useState<WorkflowEntryInfo | null>(session.made);
  const [scheduleOpen, setScheduleOpen] = useState(initialScheduleOpen || session.made !== null);
  const path = made?.path ?? pathOf(session.where, folder, session.file);
  const workflow: WorkflowEntryInfo = made ?? { id: `new::${session.file}`, name: session.file, path, project: session.where === "project" ? folder : null, state: "ok", inputs: [], description: "", title: session.title };
  const id = made?.id ?? null;
  return (
    <div data-screen="workflow-new" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 font-ui text-lg font-semibold">
            <span className="min-w-0 truncate">{session.title}</span>
            <Code tone="muted" className="shrink-0 font-normal">
              {session.file}.py
            </Code>
          </h1>
          <p className="text-meta text-muted">
            {made === null ? (
              <>
                {session.note === "" ? "A new workflow." : session.note} Nothing has run and nothing is saved. Save writes <Code tone="muted">{path}</Code>.
              </>
            ) : (
              <>
                Saved as <Code tone="muted">{made.path}</Code>. It has not run.
              </>
            )}
          </p>
          {session.writtenBy === null ? null : <p className="text-meta text-faint">Written by {session.writtenBy}.</p>}
        </div>
        {made === null ? (
          <Button size="sm" onClick={onBack}>
            Back to the form
          </Button>
        ) : null}
      </header>
      {id !== null && scheduleOpen ? <ScheduleAsk id={id} onNavigate={onNavigate} onClose={() => setScheduleOpen(false)} /> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkflowEditor
          workflow={workflow}
          steps={session.made === null ? [] : session.steps}
          code={session.made === null ? "" : session.code}
          codeHash={session.hash ?? "unsaved"}
          onCheck={id === null || onCheck === undefined ? undefined : (text) => onCheck(id, text)}
          onEditStep={id === null || onEditStep === undefined ? undefined : (text, stepId, name, value) => onEditStep(id, text, stepId, name, value)}
          onSave={async (text, base) => {
            if (made !== null) return onSave(made.id, text, base);
            const created = await onCreate(session.file, session.where === "project" ? folder : null, text);
            setMade(created.workflow);
            setScheduleOpen(true);
            return created;
          }}
          workflowModel={session.workflowModel ?? null}
          models={models}
          agents={agents}
          initial={{ text: session.code, steps: session.steps, problems: session.problems, view: session.view }}
        />
      </div>
    </div>
  );
}

/** `/workflows/new`: the ways to start a workflow. Describe it, a starter, an empty file; from a chat is named as coming. */
export function WorkflowNew({ starters, workflows, folder, models, defaultModel, agents, onAddStarter, onDraft, onCreate, onSave, onCheck, onEditStep, onNavigate, initial }: WorkflowNewProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [ask, setAsk] = useState(initial?.ask ?? "");
  const [where, setWhere] = useState<SaveWhere>(initial?.where ?? "yours");
  const [model, setModel] = useState(initial?.model ?? "");
  const [session, setSession] = useState<NewSession | null>(initial?.session ?? null);
  const [writing, setWriting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(initial?.draftError ?? null);
  const [createError, setCreateError] = useState<string | null>(initial?.createError ?? null);
  const [serverNameError, setServerNameError] = useState<string | null>(initial?.nameError ?? null);
  const [asked, setAsked] = useState(false);
  const nameId = useId();
  const nameNoteId = useId();
  const askId = useId();
  const whereId = useId();
  const modelId = useId();
  const nameBox = useRef<HTMLInputElement>(null);
  const turn = useRef(0);
  const place: SaveWhere = where === "project" && folder === null ? "yours" : where;
  const target = folder !== null && place === "project" ? folder : null;
  const typed = name.trim() === "" ? null : workflowFileName(name);
  const file = typed !== null && "file" in typed ? typed : null;
  const taken = namesIn(workflows, place, folder);
  const clash = file !== null && taken.includes(file.file);
  const free = file === null ? null : suggestFreeName(file.file, taken);
  const nameProblem = serverNameError ?? (clash && file !== null && free !== null ? nameTakenWords(file.file, free) : typed !== null && "problem" in typed ? typed.problem : asked && typed === null ? "Give the workflow a name." : null);
  const freeToUse = clash && free !== null ? free : null;

  function needName(): boolean {
    setAsked(true);
    setServerNameError(null);
    if (file === null) {
      nameBox.current?.focus();
      return false;
    }
    return true;
  }

  async function write(sentence?: string): Promise<void> {
    const wish = (sentence ?? ask).trim();
    if (!needName() || file === null || writing) return;
    if (wish === "") {
      setDraftError("Say what the workflow should do, in a few sentences.");
      return;
    }
    turn.current += 1;
    const mine = turn.current;
    setWriting(true);
    setDraftError(null);
    try {
      const result = await onDraft(name.trim(), wish, target, model === "" ? null : model);
      if (mine !== turn.current) return;
      setSession({ code: result.code, steps: result.steps ?? [], problems: result.problems ?? [], workflowModel: result.workflow_model ?? null, note: result.note, writtenBy: result.model, file: file.file, title: file.title, where: place, hash: null, made: null, view: "both" });
    } catch (error) {
      if (mine !== turn.current) return;
      setDraftError(actionErrorText(error, "golem could not write the steps."));
    } finally {
      if (mine === turn.current) setWriting(false);
    }
  }

  async function createEmpty(): Promise<void> {
    if (!needName() || file === null || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await onCreate(name.trim(), target, null);
      setSession({ code: result.code, steps: result.steps ?? [], problems: result.problems ?? [], workflowModel: result.workflow_model ?? null, note: "", writtenBy: null, file: file.file, title: file.title, where: place, hash: result.code_hash, made: result.workflow, view: "code" });
    } catch (error) {
      const text = actionErrorText(error, "The file could not be created.");
      // A refusal about the name belongs beside the name; anything else under the button.
      if (/exists already|called .* exists/.test(text)) setServerNameError(text);
      else setCreateError(text);
    } finally {
      setCreating(false);
    }
  }

  if (session !== null) {
    return (
      <NewEditor
        key={session.file}
        session={session}
        folder={folder}
        models={models}
        agents={agents}
        onCreate={onCreate}
        onSave={onSave}
        onCheck={onCheck}
        onEditStep={onEditStep}
        onNavigate={onNavigate}
        onBack={() => setSession(null)}
        initialScheduleOpen={initial?.scheduleOpen ?? false}
      />
    );
  }

  return (
    <div data-screen="workflow-new" className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-prose text-2xl font-normal tracking-tight">{NEW_WORKFLOW_TITLE}</h1>
        <p className="text-sm text-pretty text-muted">{NEW_WORKFLOW_INTRO}</p>
      </div>
      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Name and place</h2>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <Label id={nameId}>Name</Label>
            <Input
              id={nameId}
              ref={nameBox}
              type="text"
              value={name}
              placeholder="Weekly invoices"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={nameProblem !== null}
              aria-describedby={nameNoteId}
              onChange={(event) => {
                setName(event.target.value);
                setServerNameError(null);
              }}
            />
            <p id={nameNoteId} role={nameProblem === null ? undefined : "alert"} className={cn("min-h-4 text-meta wrap-anywhere", nameProblem === null ? "text-faint" : "text-deny")}>
              {nameProblem ?? (file === null ? "The file is named from it: weekly_invoices.py." : `File: ${pathOf(place, folder, file.file)}`)}
              {freeToUse === null ? null : (
                <>
                  {" "}
                  <button type="button" onClick={() => setName(freeToUse)} className="cursor-pointer text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2">
                    Use {freeToUse}
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <Label id={whereId}>Saved in</Label>
            <select
              id={whereId}
              value={place}
              onChange={(event) => {
                setWhere(event.target.value === "project" ? "project" : "yours");
                setServerNameError(null);
              }}
              className={fieldClass}
            >
              <option value="yours">{saveInWords(null)}</option>
              {folder === null ? null : <option value="project">{saveInWords(folder)}</option>}
            </select>
            <p className="text-meta text-faint">{folder === null ? "A project's workflows folder is offered when you are in a project." : "A project's folder must be trusted; if it is not, the daemon says so."}</p>
          </div>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{DESCRIBE_TITLE}</h2>
        <p className="text-sm text-muted">{DESCRIBE_HELP}</p>
        <Label id={askId}>What should it do?</Label>
        <Textarea
          id={askId}
          value={ask}
          rows={4}
          placeholder="Every Friday, read the CSV files in ~/Documents/invoices that are new this week, add up the totals by client, and give me a table. Ask me before anything is sent."
          onChange={(event) => setAsk(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-faint">Try</span>
          {DESCRIBE_TRIES.map((one) => (
            <button
              key={one}
              type="button"
              onClick={() => setAsk(one)}
              className="cursor-pointer rounded-full border border-line bg-surface px-2.5 py-0.5 text-meta text-muted outline-offset-2 outline-clay hover:border-line-strong hover:text-ink focus-visible:outline-2"
            >
              {one}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-t border-line pt-3">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <Label id={modelId}>Model</Label>
            <select id={modelId} value={model} onChange={(event) => setModel(event.target.value)} className={fieldClass}>
              <option value="">{defaultModel === null ? "golem's default model" : `golem's default model (now ${defaultModel})`}</option>
              {models.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
            <p className="text-meta text-faint">{describeModelWords(model === "" ? null : model, defaultModel)}</p>
          </div>
          <Button kind="primary" onClick={() => void write()}>
            {writing ? "golem is writing…" : WRITE_STEPS_WORDS}
          </Button>
        </div>
        {draftError === null ? null : (
          <p role="alert" className="rounded-md border border-deny bg-deny-soft px-2.5 py-1.5 text-sm text-deny wrap-anywhere">
            {draftError}
          </p>
        )}
        {writing ? (
          <p role="status" className="text-sm text-muted">
            golem is writing the steps. Nothing is saved.
          </p>
        ) : null}
      </Card>
      <div className="flex flex-wrap gap-3">
        <Card className="flex flex-1 basis-64 flex-col gap-2">
          <h2 className="text-sm font-semibold">{EMPTY_FILE_TITLE}</h2>
          <p className="flex-1 text-sm text-pretty text-muted">{EMPTY_FILE_HELP}</p>
          {createError === null ? null : (
            <p role="alert" className="rounded-md border border-deny bg-deny-soft px-2.5 py-1.5 text-xs text-deny wrap-anywhere">
              {createError}
            </p>
          )}
          <div>
            <Button size="sm" onClick={() => void createEmpty()}>
              {creating ? "Creating" : CREATE_WORDS}
            </Button>
          </div>
        </Card>
        <Card className="flex flex-1 basis-64 flex-col gap-2">
          <h2 className="text-sm font-semibold">{FROM_CHAT_TITLE}</h2>
          <p className="text-sm text-pretty text-muted">{FROM_CHAT_HELP}</p>
        </Card>
      </div>
      {starters.length === 0 ? null : (
        <section aria-labelledby="new-workflow-starters" className="flex flex-col gap-2">
          <h2 id="new-workflow-starters" className="text-sm font-semibold">
            {STARTERS_TITLE}
          </h2>
          <p className="text-sm text-muted">{STARTERS_HELP}</p>
          <ul aria-label="Starter workflows" className="grid gap-3 sm:grid-cols-2">
            {starters.map((starter) => (
              <li key={starter.id}>
                <StarterCard starter={starter} folder={folder} onAdd={onAddStarter} failed={undefined} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <Card className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-faint">What happens next</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted">
          {NEXT_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
