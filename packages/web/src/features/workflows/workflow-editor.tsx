import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { WorkflowCheckResult, WorkflowEditStepResult, WorkflowEntryInfo, WorkflowOutlineStep, WorkflowProblem, WorkflowProposeResult, WorkflowSaveResult } from "../../store/workflows.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Input } from "../../ui/input.tsx";
import { cn } from "../../ui/cn.ts";
import { CodeEditor } from "../settings/config/code-editor.tsx";
import { StepFields } from "./step-fields.tsx";
import { changedLines, compareSteps, groupWords, lineDiff, problemCounts, repeatWords, stepAtLine, stepKindWords, stepNumberLines, stepRange, stepUses, type StepChange } from "./text.ts";

/** How long the code rests before it is checked. */
export const CHECK_DELAY_MS = 600;

export type EditorView = "outline" | "both" | "code";

const VIEWS: readonly { view: EditorView; label: string }[] = [
  { view: "outline", label: "Steps" },
  { view: "both", label: "Steps and code" },
  { view: "code", label: "Code" },
];

export type WorkflowEditorProps = {
  workflow: WorkflowEntryInfo;
  /** The outline of the saved file, until a check or a save brings a newer one. */
  steps: readonly WorkflowOutlineStep[];
  /** The text of the file. */
  code: string;
  /** The hash of that text, which a save names as its base. Null when the daemon sent none: the code is then read only. */
  codeHash: string | null;
  /** Checks a text without writing it. Without it, the outline and problems are not redrawn as you type. */
  onCheck?: (code: string) => Promise<WorkflowCheckResult>;
  /** Writes the text. Rejects with the daemon's reason. Without it, the code is read only. */
  onSave?: (code: string, baseHash: string) => Promise<WorkflowSaveResult>;
  /** Asks golem for a change to `code` (workflow.propose), with the last proposal and its note for a refine. Rejects with the daemon's reason. Without it, the ask box is not offered. */
  onPropose?: (code: string, ask: string, previous?: { code: string; note: string }) => Promise<WorkflowProposeResult>;
  /** Sets one argument of one step in a text, without writing it (`workflow.edit_step`). Without it, the fields of a step are shown but not edited. */
  onEditStep?: (code: string, stepId: string, name: string, value: string) => Promise<WorkflowEditStepResult>;
  /** The agent types a step may name, for its agent field. */
  agents?: readonly string[];
  /** Opens the agent file of a type. Without it, the field has no link. */
  onOpenAgent?: (name: string) => void;
  /** Opens the file's folder in Finder. Without it, the action is not offered. */
  onReveal?: (path: string) => Promise<void>;
  /** Told whenever the text differs from the saved one, or stops doing so. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Told how many problems the last check found, or null before any check has come back, for the page header's Checks pill. */
  onProblemsChange?: (count: number | null) => void;
  /** A state to start in, for the gallery and tests. */
  initial?: { text?: string; steps?: readonly WorkflowOutlineStep[]; problems?: readonly WorkflowProblem[]; selected?: string; view?: EditorView; saveError?: string; ask?: string; asked?: string; proposal?: WorkflowProposeResult; writing?: boolean; proposeError?: string; refusedField?: { name: string; message: string } };
};

function ProblemMark({ problem }: { problem: WorkflowProblem }) {
  return <span aria-hidden="true">{problem.severity === "error" ? "✕" : "!"}</span>;
}

function whereText(problem: WorkflowProblem, steps: readonly WorkflowOutlineStep[]): string {
  const at = problem.step_id === null || problem.step_id === undefined ? -1 : steps.findIndex((step) => step.id === problem.step_id);
  return at < 0 ? `line ${problem.line}` : `line ${problem.line} · step ${at + 1}`;
}

function KindTag({ kind }: { kind: string }) {
  return <span className="shrink-0 rounded-md border border-line bg-bg px-1.5 py-0.5 text-meta font-normal text-muted">{stepKindWords(kind)}</span>;
}

function NumberDot({ number, selected }: { number: number; selected: boolean }) {
  return <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-meta font-medium", selected ? "bg-clay text-on-clay" : "bg-bg text-muted ring-1 ring-line")}>{number}</span>;
}

function StepCard({ step, number, selected, problems, change, onSelect }: { step: WorkflowOutlineStep; number: number; selected: boolean; problems: readonly WorkflowProblem[]; change?: StepChange; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={selected ? "step" : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border bg-surface px-2.5 py-2 text-left outline-offset-2 outline-clay focus-visible:outline-2",
        selected ? "border-clay bg-clay-soft" : change === "new" ? "border-dashed border-allow bg-allow-soft" : change === "changed" ? "border-clay" : "border-line hover:border-line-strong",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <NumberDot number={number} selected={selected} />
        <span className="min-w-0 flex-1 wrap-anywhere">
          {step.title}
          {step.item ? (
            <span className="ml-2 font-normal">
              <Code tone="muted">{step.item}</Code>
            </span>
          ) : null}
        </span>
        <KindTag kind={step.kind} />
        {change === undefined ? null : <span className={cn("shrink-0 text-meta", change === "new" ? "text-allow" : "text-clay-ink")}>{change}</span>}
      </span>
      {step.for_each ? <span className="pl-7 text-meta text-muted wrap-anywhere">↻ {repeatWords(step.for_each)}</span> : null}
      {step.condition ? (
        <span className="pl-7 text-meta text-muted wrap-anywhere">
          if <Code tone="muted">{step.condition}</Code>
        </span>
      ) : null}
      {problems.map((problem, at) => (
        <span key={at} className={cn("pl-7 text-meta wrap-anywhere", problem.severity === "error" ? "text-deny" : "text-wait")}>
          <ProblemMark problem={problem} /> {problem.message}
        </span>
      ))}
    </button>
  );
}

/** The steps in order. Steps that run at the same time sit in one dashed box: the first of them carries its title and count, and the box is drawn around them by their borders. */
function Outline({ steps, selected, problemsOf, changes, onSelect }: { steps: readonly WorkflowOutlineStep[]; selected: string | null; problemsOf: (step: WorkflowOutlineStep) => WorkflowProblem[]; changes?: ReadonlyMap<string, StepChange>; onSelect: (step: WorkflowOutlineStep) => void }) {
  if (steps.length === 0) return <p className="text-sm text-muted">No steps found in the code.</p>;
  return (
    <ol aria-label="Outline" className="flex flex-col">
      {steps.map((step, at) => {
        const group = step.group ?? null;
        const before = at === 0 ? null : (steps[at - 1]?.group ?? null);
        const after = steps[at + 1]?.group ?? null;
        const first = group !== null && group !== before;
        const last = group !== null && group !== after;
        const size = first ? steps.slice(at).findIndex((other) => (other.group ?? null) !== group) : 0;
        const count = first ? (size < 0 ? steps.length - at : size) : 0;
        return (
          <li key={step.id} className="flex flex-col">
            {at === 0 || (group !== null && !first) ? null : <span aria-hidden="true" className="mx-auto h-3 w-px bg-line-strong" />}
            <div className={cn(group !== null && "flex flex-col gap-1.5 border-x border-dashed border-line-strong px-2 pb-1.5", first && "rounded-t-lg border-t pt-2", last && "rounded-b-lg border-b")}>
              {first ? (
                <span className="flex flex-wrap items-center gap-x-2 px-1 text-meta text-muted">
                  <span className="font-medium text-ink">{groupWords(step)}</span>
                  <span className="text-faint">· these {count} run at the same time</span>
                </span>
              ) : null}
              <StepCard step={step} number={at + 1} selected={selected === step.id} problems={problemsOf(step)} change={changes?.get(step.id)} onSelect={() => onSelect(step)} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-16 shrink-0 text-meta text-faint">{name}</dt>
      <dd className="min-w-0 flex-1 wrap-anywhere">{children}</dd>
    </div>
  );
}

type StepPaneProps = {
  step: WorkflowOutlineStep | null;
  number: number;
  /** The outline, to name the steps this one uses. */
  steps: readonly WorkflowOutlineStep[];
  lines: readonly string[];
  text: string;
  /** Sets one argument of the step. Without it, the fields are only shown. */
  onEdit?: (name: string, value: string) => Promise<void>;
  agents?: readonly string[];
  onOpenAgent?: (name: string) => void;
  onJump?: (line: number) => void;
  /** Switches to Steps and code and shows the step's lines. Without it, no link. */
  onShow?: () => void;
  refused?: { name: string; message: string } | null;
};

function StepPane({ step, number, steps, lines, text, onEdit, agents, onOpenAgent, onJump, onShow, refused }: StepPaneProps) {
  if (step === null) return <p className="text-sm text-muted">Pick a step in the outline, or put the cursor in its lines.</p>;
  const range = stepRange(step);
  const brief = step.brief_line === null || step.brief_line === undefined ? null : (text.split("\n")[step.brief_line - 1]?.trim() ?? null);
  const editable = onEdit !== undefined && step.kind !== "code";
  const where = range === null ? null : range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`;
  const uses = stepUses(steps, step);
  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        <NumberDot number={number} selected />
        <span className="min-w-0 wrap-anywhere">
          {step.title}
          {step.item ? (
            <span className="ml-2 text-sm font-normal">
              <Code tone="muted">{step.item}</Code>
            </span>
          ) : null}
        </span>
        <KindTag kind={step.kind} />
      </h3>
      {step.does ? <p className="max-w-prose text-sm text-pretty text-ink-soft">{step.does}</p> : null}
      <dl aria-label="About the step" className="flex flex-col gap-1.5">
        {step.for_each ? <Field name="Repeats">{repeatWords(step.for_each)}</Field> : null}
        {step.condition ? (
          <Field name="Only if">
            <Code tone="muted">{step.condition}</Code>
          </Field>
        ) : null}
        <Field name="Uses">
          {uses.length === 0 ? (
            <span className="text-faint">nothing</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {uses.map((use) => (
                <span key={use.number} className="rounded-md border border-line bg-bg px-1.5 py-0.5 text-meta">
                  {use.title} · step {use.number}
                </span>
              ))}
            </span>
          )}
        </Field>
        {editable || !step.agent ? null : <Field name="Agent">{step.agent}</Field>}
        {editable || brief === null ? null : (
          <Field name="Brief">
            <Code tone="muted">{brief}</Code>
          </Field>
        )}
        {step.gets ? <Field name="Gets">{step.gets}</Field> : null}
        {editable || !step.key ? null : (
          <Field name="Only once">
            <Code tone="muted">key={step.key}</Code>
          </Field>
        )}
        {editable || !step.budget ? null : <Field name="Budget">{step.budget}</Field>}
      </dl>
      {editable ? <StepFields step={step} onEdit={onEdit} agents={agents} onOpenAgent={onOpenAgent} onJump={onJump} refused={refused} /> : null}
      {lines.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h4 className="text-meta font-medium text-faint">Code</h4>
            {where === null ? null : <span className="text-meta text-faint">{range !== null && range[0] !== range[1] ? `lines ${where}` : `line ${where}`}</span>}
            <span className="min-w-0 flex-1" />
            {onShow === undefined ? null : (
              <button type="button" onClick={onShow} className="text-meta text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2">
                Show in the file
              </button>
            )}
          </div>
          <pre aria-label="Lines of the step" className="rounded-md border border-line bg-surface p-2 font-mono text-code whitespace-pre-wrap text-ink wrap-anywhere">{lines.join("\n")}</pre>
        </div>
      )}
      <p className="text-meta text-faint">
        {step.kind === "code"
          ? "A code step has no fields to edit here. Its function opens in the code pane."
          : editable
            ? `Each field writes one argument${where === null ? "" : ` on line${range !== null && range[0] !== range[1] ? "s" : ""} ${where}`}. A value the code computes is shown "set in code", never edited here.`
            : "Read only. Each field is read from the code. Change the code to change a step."}
      </p>
    </div>
  );
}

/** The proposal as a line diff against the text in the editor: green lines are added, red are removed, long runs of unchanged lines fold. */
function DiffView({ before, after, name }: { before: string; after: string; name: string }) {
  const { rows } = lineDiff(before, after);
  return (
    <div className="flex min-h-96 min-w-0 flex-1 flex-col gap-2 lg:min-h-0">
      <h2 className="text-meta font-medium text-faint">Diff, {name}</h2>
      <ol aria-label="Diff" className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface py-1 text-code">
        {rows.map((row, at) => (
          <li key={at} className={cn("flex gap-2 whitespace-pre px-2", row.kind === "add" && "bg-allow-soft text-allow", row.kind === "del" && "bg-deny-soft text-deny", row.kind === "skip" && "text-faint")}>
            <span aria-hidden="true" className="w-8 shrink-0 text-right text-faint">
              {row.line ?? ""}
            </span>
            {row.kind === "skip" ? (
              <span>
                {row.skipped} unchanged {row.skipped === 1 ? "line" : "lines"}
              </span>
            ) : (
              <>
                <span aria-hidden="true" className="w-3 shrink-0">
                  {row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}
                </span>
                <span className="sr-only">{row.kind === "add" ? "Added: " : row.kind === "del" ? "Removed: " : ""}</span>
                <Code tone="inherit">{row.text}</Code>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Text with each "step N" turned into a button that selects that step, when the workflow has one. */
function AnswerText({ text, steps, onPick }: { text: string; steps: readonly WorkflowOutlineStep[]; onPick: (step: WorkflowOutlineStep) => void }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed wrap-anywhere">
      {text.split(/(\bstep \d+\b)/i).map((part, at) => {
        const found = /^step (\d+)$/i.exec(part);
        const step = found === null ? undefined : steps[Number(found[1]) - 1];
        if (step === undefined) return part;
        return (
          <button key={at} type="button" onClick={() => onPick(step)} className="rounded-sm bg-clay-soft px-1 font-medium text-clay-ink underline-offset-2 outline-offset-2 outline-clay hover:underline focus-visible:outline-2">
            {part}
          </button>
        );
      })}
    </p>
  );
}

type ReplyProps = {
  asked: string | null;
  proposal: WorkflowProposeResult;
  /** An answer changes nothing: no Apply. */
  answerOnly: boolean;
  steps: readonly WorkflowOutlineStep[];
  changes: readonly { change: StepChange; title: string }[];
  summary: string;
  onPick: (step: WorkflowOutlineStep) => void;
  onApply: () => void;
  onSeeCode: () => void;
  onChange: () => void;
  onClose: () => void;
};

/** What golem said to the ask, just above the ask box: an answer (nothing is changed) or a change (not saved yet). */
function AskReply({ asked, proposal, answerOnly, steps, changes, summary, onPick, onApply, onSeeCode, onChange, onClose }: ReplyProps) {
  return (
    <div role="group" aria-label={answerOnly ? "Answer" : "Proposal"} className={cn("flex shrink-0 flex-col rounded-lg border bg-bg", answerOnly ? "border-line" : "border-allow")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-2">
        {asked === null ? null : (
          <>
            <span className="text-meta text-faint">You asked</span>
            <span className="min-w-0 text-sm font-medium wrap-anywhere">{asked}</span>
          </>
        )}
        <Badge tone={answerOnly ? "neutral" : "wait"}>{answerOnly ? "Answer · nothing is changed" : "Change · not saved yet"}</Badge>
        <span className="min-w-0 flex-1" />
        <Button size="sm" aria-label="Close" onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto px-3 py-2">
        {answerOnly ? (
          <>
            <AnswerText text={proposal.answer ?? proposal.note} steps={steps} onPick={onPick} />
            <p className="text-meta text-faint">Click a step to see it. Ask more below.</p>
          </>
        ) : (
          <>
            {changes.length === 0 ? null : (
              <ul aria-label="What changes" className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {changes.map((one, at) => (
                  <li key={at}>
                    <span className={one.change === "new" ? "text-allow" : "text-clay-ink"}>{one.change === "new" ? "New" : "Changed"}</span> · <b>{one.title}</b>
                  </li>
                ))}
              </ul>
            )}
            {proposal.note === "" ? null : (
              <p className="text-sm wrap-anywhere">
                <b>golem:</b> {proposal.note}
              </p>
            )}
            <p className="text-meta text-faint">{summary}</p>
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" size="sm" onClick={onApply}>
                Apply
              </Button>
              <Button size="sm" onClick={onSeeCode}>
                See the code change
              </Button>
              <Button size="sm" onClick={onChange}>
                Change it…
              </Button>
              <Button size="sm" onClick={onClose}>
                Discard
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The ask box under the editor: chips, one line, and a button. With a proposal on the screen the same box refines it. */
function AskBox({ value, onChange, onAsk, chips, refining, working, inputRef }: { value: string; onChange: (value: string) => void; onAsk: (sentence?: string) => void; chips: readonly string[]; refining: boolean; working: boolean; inputRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg p-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAsk();
      }}
    >
      <span className="text-meta text-faint">{refining ? "refine" : "ask golem"} ⌘K</span>
      {refining
        ? null
        : chips.map((chip) => (
            <button key={chip} type="button" disabled={working} onClick={() => onAsk(chip)} className="rounded-full border border-line bg-surface px-2.5 py-1 text-meta text-muted outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2">
              {chip}
            </button>
          ))}
      <Input ref={inputRef} aria-label={refining ? "One more sentence on the proposal" : "Ask golem to change this workflow"} placeholder={refining ? "One more sentence on top of this proposal" : "Ask a question, or say what to change"} value={value} disabled={working} onChange={(event) => onChange(event.target.value)} className="min-w-48 flex-1" />
      <Button kind="primary" size="sm" type="submit" disabled={working || value.trim() === ""}>
        {refining ? "Refine" : "Ask"}
      </Button>
    </form>
  );
}

/**
 * The Code tab of a workflow: the outline read from the code, the code with the step numbers in its margin,
 * and the selected step. Typing redraws the outline and the problems after a pause (`workflow.check`); Save
 * (or ⌘S) writes the file (`workflow.save`) against the hash the editor started from.
 */
export function WorkflowEditor({ workflow, steps: savedSteps, code, codeHash, onCheck, onSave, onPropose, onEditStep, agents, onOpenAgent, onReveal, onDirtyChange, onProblemsChange, initial }: WorkflowEditorProps) {
  const readOnly = workflow.state !== "ok" || onSave === undefined || codeHash === null;
  const [text, setText] = useState(initial?.text ?? code);
  const [saved, setSaved] = useState(code);
  const [hash, setHash] = useState(codeHash);
  const [steps, setSteps] = useState<readonly WorkflowOutlineStep[]>(initial?.steps ?? savedSteps);
  const [problems, setProblems] = useState<readonly WorkflowProblem[]>(initial?.problems ?? []);
  const [checked, setChecked] = useState(initial?.problems !== undefined);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(initial?.saveError ?? null);
  const [justSaved, setJustSaved] = useState(false);
  const [view, setView] = useState<EditorView>(initial?.view ?? "both");
  const [selectedId, setSelectedId] = useState<string | null>(initial?.selected ?? null);
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | undefined>(undefined);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [ask, setAsk] = useState(initial?.ask ?? "");
  const [askedText, setAskedText] = useState<string | null>(initial?.asked ?? null);
  const [seeCode, setSeeCode] = useState(0);
  const diffBox = useRef<HTMLDivElement>(null);
  const [proposal, setProposal] = useState<WorkflowProposeResult | null>(initial?.proposal ?? null);
  const [writing, setWriting] = useState(initial?.writing ?? false);
  const [proposeError, setProposeError] = useState<string | null>(initial?.proposeError ?? null);
  const asking = useRef(0);
  const askBox = useRef<HTMLInputElement>(null);
  const asked = useRef<string | null>(initial?.problems !== undefined ? text : null);
  const turn = useRef(0);
  const check = useRef(onCheck);
  useEffect(() => {
    check.current = onCheck;
  });

  const dirty = text !== saved;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const problemCount = checked || problems.length > 0 ? problems.length : null;
  useEffect(() => {
    onProblemsChange?.(problemCount);
  }, [problemCount, onProblemsChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // After a pause in typing, ask for a check. A text is asked once, and an answer for an older text is dropped.
  useEffect(() => {
    if (check.current === undefined || readOnly || asked.current === text) return;
    const timer = setTimeout(() => {
      const ask = check.current;
      if (ask === undefined) return;
      asked.current = text;
      turn.current += 1;
      const mine = turn.current;
      setChecking(true);
      ask(text).then(
        (result) => {
          if (mine !== turn.current) return;
          setSteps(result.steps ?? []);
          setProblems(result.problems ?? []);
          setChecked(true);
          setCheckError(null);
          setChecking(false);
        },
        (error: unknown) => {
          if (mine !== turn.current) return;
          setCheckError(actionErrorText(error, "Could not check the code."));
          setChecking(false);
        },
      );
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, readOnly]);

  // An answer changes nothing. An older daemon sends no kind: a file left as it is counts as an answer.
  const answerOnly = proposal !== null && (proposal.kind === "answer" || (proposal.kind === undefined && proposal.code === text));
  const proposing = proposal !== null && !answerOnly;
  const shownSteps = proposing ? (proposal.steps ?? []) : steps;
  const shownProblems = proposing ? (proposal.problems ?? []) : problems;
  const changes = proposing ? compareSteps(steps, proposal.steps ?? []) : undefined;
  const diff = proposing ? lineDiff(text, proposal.code) : null;
  const added = [...(changes?.values() ?? [])].filter((change) => change === "new").length;
  const changedSteps = (changes?.size ?? 0) - added;
  const changeList = (proposal?.steps ?? []).flatMap((step) => {
    const change = changes?.get(step.id);
    return change === undefined ? [] : [{ change, title: step.title }];
  });
  const numbers = stepNumberLines(steps);
  const marked = new Set(numbers.keys());
  const selected = steps.find((step) => step.id === selectedId) ?? null;
  const selectedAt = selected === null ? 0 : steps.indexOf(selected) + 1;
  const range = selected === null ? null : stepRange(selected);
  const lines = text.split("\n");
  const bands: { from: number; to: number; kind: "step" | "problem" }[] = [];
  if (range !== null) bands.push({ from: range[0], to: range[1], kind: "step" });
  for (const problem of problems) if (problem.severity === "error") bands.push({ from: problem.line, to: problem.line, kind: "problem" });
  const problemLines = new Set(problems.map((problem) => problem.line));
  const problemsOf = (step: WorkflowOutlineStep) => shownProblems.filter((problem) => problem.step_id === step.id);

  function pick(step: WorkflowOutlineStep): void {
    setSelectedId(step.id);
    const start = stepRange(step);
    if (start !== null) setReveal({ line: start[0], nonce: (reveal?.nonce ?? 0) + 1 });
  }

  function askGolem(chip?: string): void {
    const sentence = (chip ?? ask).trim();
    if (onPropose === undefined || sentence === "" || writing) return;
    asking.current += 1;
    const mine = asking.current;
    setWriting(true);
    setProposeError(null);
    onPropose(text, sentence, proposal === null || answerOnly ? undefined : { code: proposal.code, note: proposal.note }).then(
      (result) => {
        if (mine !== asking.current) return;
        setProposal(result);
        setAskedText(sentence);
        setAsk("");
        setWriting(false);
      },
      (error: unknown) => {
        if (mine !== asking.current) return;
        setProposeError(actionErrorText(error, "golem could not write a proposal."));
        setWriting(false);
      },
    );
  }

  function cancelAsk(): void {
    asking.current += 1;
    setWriting(false);
  }

  function discard(): void {
    asking.current += 1;
    setProposal(null);
    setProposeError(null);
    setWriting(false);
  }

  /** Shows the diff of the proposal, even from the outline view. */
  function showDiff(): void {
    setView((now) => (now === "outline" ? "both" : now));
    setSeeCode((now) => now + 1);
  }

  /** The proposed text becomes an edit that is not saved yet: the Save above writes it. */
  function accept(): void {
    if (proposal === null) return;
    setText(proposal.code);
    setSteps(proposal.steps ?? []);
    setProblems(proposal.problems ?? []);
    setChecked(true);
    setCheckError(null);
    setSaveError(null);
    setJustSaved(false);
    asked.current = proposal.code;
    turn.current += 1;
    setChecking(false);
    setProposal(null);
  }

  // One field of the selected step: the daemon writes that one argument into the text, and the text is an unsaved edit.
  async function editField(name: string, value: string): Promise<void> {
    if (selected === null || onEditStep === undefined) return;
    const at = steps.indexOf(selected);
    const result = await onEditStep(text, selected.id, name, value);
    const next = result.steps ?? [];
    setText(result.code);
    setSteps(next);
    setProblems(result.problems ?? []);
    setChecked(true);
    setCheckError(null);
    setChecking(false);
    asked.current = result.code;
    turn.current += 1;
    // The id may follow the argument (the agent type or the key): the step stays selected by its place.
    const same = next.find((step) => step.id === selected.id) ?? (next.length === steps.length ? next[at] : undefined);
    if (same !== undefined) setSelectedId(same.id);
  }

  function onCursor(line: number): void {
    const step = stepAtLine(steps, line);
    if (step !== null) setSelectedId(step.id);
  }

  async function save(): Promise<void> {
    if (onSave === undefined || hash === null || saving || readOnly || !dirty) return;
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      const result = await onSave(text, hash);
      setHash(result.code_hash);
      setSaved(text);
      setSteps(result.steps ?? []);
      setProblems(result.problems ?? []);
      setChecked(true);
      setCheckError(null);
      asked.current = text;
      turn.current += 1;
      setChecking(false);
      setJustSaved(true);
    } catch (error) {
      setSaveError(actionErrorText(error, "Could not save the file."));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "k" && onPropose !== undefined && !readOnly) {
      event.preventDefault();
      askBox.current?.focus();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      void save();
    }
  }

  useEffect(() => {
    if (seeCode > 0) diffBox.current?.scrollIntoView?.({ block: "nearest" });
  }, [seeCode]);

  const counts = problemCounts(shownProblems);
  const hasErrors = shownProblems.some((problem) => problem.severity === "error");
  const status = checking && !proposing ? (
    <Badge>Checking…</Badge>
  ) : checkError !== null && !proposing ? (
    <Badge tone="wait">Could not check</Badge>
  ) : !checked && !proposing ? null : hasErrors ? (
    <Badge tone="deny">✕ {counts}</Badge>
  ) : shownProblems.length > 0 ? (
    <Badge tone="wait">! {counts}</Badge>
  ) : (
    <Badge tone="allow">{proposing ? "✓ checks pass on the proposal" : "✓ checks pass"}</Badge>
  );
  const showCode = view !== "outline";
  const showOutline = view !== "code";
  const showStep = view !== "code" && !proposing;

  return (
    // The wrapper only catches ⌘S from the editor inside it.
    <div className="flex flex-col gap-3 lg:h-full" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="group" aria-label="View" className="flex overflow-hidden rounded-md border border-line-strong">
          {VIEWS.map((option) => (
            <button
              key={option.view}
              type="button"
              aria-pressed={view === option.view}
              onClick={() => setView(option.view)}
              className={cn("px-2.5 py-1 text-xs outline-offset-2 outline-clay focus-visible:outline-2", view === option.view ? "bg-ink text-bg" : "bg-surface text-muted hover:text-ink")}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span role="status" className="flex items-center gap-2">
          {status}
        </span>
        <span className="min-w-0 flex-1" />
        {dirty ? <span className="text-meta text-muted">{changedLines(saved, text) === 1 ? "1 change not saved" : `${changedLines(saved, text)} changes not saved`}</span> : justSaved ? <span className="text-meta text-allow">Saved.</span> : null}
        {readOnly || proposing ? null : (
          <>
            {dirty ? (
              <Button
                size="sm"
                onClick={() => {
                  setText(saved);
                  setSaveError(null);
                }}
              >
                Revert
              </Button>
            ) : null}
            <Button kind="primary" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 wrap-anywhere">
          <Code tone="muted">{workflow.path}</Code>
        </p>
        {onReveal === undefined ? null : (
          <Button
            size="sm"
            onClick={() => {
              setRevealError(null);
              onReveal(workflow.path).catch((err: unknown) => setRevealError(actionErrorText(err, "Could not open the folder.")));
            }}
          >
            Show in Finder
          </Button>
        )}
      </div>
      {revealError === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {revealError}
        </p>
      )}
      {saveError === null ? null : (
        <p role="alert" className="rounded-lg border border-deny bg-deny-soft px-3 py-2 text-sm text-deny wrap-anywhere">
          Not saved. {saveError}
        </p>
      )}
      {proposeError === null ? null : (
        <p role="alert" className="rounded-lg border border-deny bg-deny-soft px-3 py-2 text-sm text-deny wrap-anywhere">
          {proposeError}
        </p>
      )}
      {writing ? (
        <p role="status" className="flex items-center gap-3 text-sm text-muted">
          golem is writing…
          <Button size="sm" onClick={cancelAsk}>
            Cancel
          </Button>
        </p>
      ) : null}
      {checkError === null ? null : (
        <p role="alert" className="text-sm text-deny wrap-anywhere">
          {checkError}
        </p>
      )}
      {shownProblems.length === 0 ? null : (
        <ul aria-label="Problems" className="flex max-h-40 shrink-0 flex-col overflow-y-auto gap-1.5 rounded-lg border border-line bg-bg p-3 text-sm">
          {shownProblems.map((problem, at) => (
            <li key={at} className="flex gap-2">
              <span className={cn("shrink-0", problem.severity === "error" ? "text-deny" : "text-wait")}>
                <ProblemMark problem={problem} />
                <span className="sr-only">{problem.severity === "error" ? "Problem" : "Warning"}</span>
              </span>
              <span className="min-w-0 wrap-anywhere">
                <button
                  type="button"
                  onClick={() => setReveal({ line: problem.line, nonce: (reveal?.nonce ?? 0) + 1 })}
                  className="font-medium underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2"
                >
                  {whereText(problem, shownSteps)}
                </button>
                {" · "}
                {problem.message}
                {problem.fix ? <span className="text-muted"> Fix: {problem.fix}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3 lg:min-h-48 lg:flex-1 lg:flex-row lg:items-stretch">
        {showOutline ? (
          <div className={cn("flex min-w-0 flex-col gap-2 lg:min-h-0 lg:shrink-0 lg:overflow-y-auto", view === "outline" ? "lg:w-100" : "lg:w-72")}>
            <h2 className="text-meta font-medium text-faint">Steps, read from the code</h2>
            <Outline steps={shownSteps} selected={proposing ? null : selectedId} problemsOf={problemsOf} changes={changes} onSelect={proposing ? () => undefined : pick} />
          </div>
        ) : null}
        {showCode && diff !== null ? (
          <div ref={diffBox} className="flex min-w-0 flex-1 flex-col lg:min-h-0">
            <DiffView before={text} after={proposal?.code ?? text} name={workflow.name} />
          </div>
        ) : showCode ? (
          <div className="flex min-h-96 min-w-0 flex-1 flex-col gap-2 lg:min-h-0">
            <CodeEditor
              value={text}
              onChange={setText}
              marked={marked}
              stepNumbers={numbers}
              problems={problemLines}
              bands={bands}
              onCursor={onCursor}
              reveal={reveal}
              label={`Code of ${workflow.name}`}
              language="python"
              readOnly={readOnly}
              markKind="step"
              className="lg:min-h-0"
            />
            <p className="text-meta text-faint">
              {readOnly
                ? workflow.state === "ok"
                  ? "Read only. Edit the file in your own editor."
                  : "Read only. The project is not trusted. Trust it in Settings to edit."
                : "A number in the margin is the step that starts on that line. Save writes the file; ⌘S does the same."}
            </p>
          </div>
        ) : null}
        {showStep ? (
          <div role="group" aria-label="Selected step" className={cn("flex min-w-0 flex-col gap-2 lg:min-h-0 lg:overflow-y-auto", view === "outline" ? "lg:flex-1" : "lg:w-72 lg:shrink-0")}>
            <h2 className="text-meta font-medium text-faint">Step</h2>
            <StepPane
              step={selected}
              number={selectedAt}
              steps={steps}
              lines={range === null ? [] : lines.slice(range[0] - 1, range[1])}
              text={text}
              onEdit={readOnly || onEditStep === undefined ? undefined : editField}
              agents={agents}
              onOpenAgent={onOpenAgent}
              onJump={(line) => setReveal({ line, nonce: (reveal?.nonce ?? 0) + 1 })}
              onShow={
                view === "both" || range === null
                  ? undefined
                  : () => {
                      setView("both");
                      setReveal({ line: range[0], nonce: (reveal?.nonce ?? 0) + 1 });
                    }
              }
              refused={initial?.refusedField ?? null}
            />
          </div>
        ) : null}
      </div>
      {proposal === null ? null : (
        <AskReply
          asked={askedText}
          proposal={proposal}
          answerOnly={answerOnly}
          steps={steps}
          changes={changeList}
          summary={`${added === 1 ? "1 step added" : `${added} steps added`}, ${changedSteps} changed · +${diff?.added ?? 0} −${diff?.removed ?? 0}`}
          onPick={pick}
          onApply={accept}
          onSeeCode={showDiff}
          onChange={() => askBox.current?.focus()}
          onClose={discard}
        />
      )}
      {onPropose === undefined || readOnly ? null : (
        <AskBox value={ask} onChange={setAsk} onAsk={askGolem} chips={["explain this workflow", ...(selectedAt > 0 ? [`explain step ${selectedAt}`] : []), "make it cheaper"]} refining={proposing} working={writing} inputRef={askBox} />
      )}
    </div>
  );
}
