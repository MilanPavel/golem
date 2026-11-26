import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { actionErrorText } from "../../store/errors.ts";
import type { WorkflowCheckResult, WorkflowEntryInfo, WorkflowOutlineStep, WorkflowProblem, WorkflowSaveResult } from "../../store/workflows.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { cn } from "../../ui/cn.ts";
import { CodeEditor } from "../settings/config/code-editor.tsx";
import { changedLines, problemCounts, stepAtLine, stepNotes, stepNumberLines, stepRange } from "./text.ts";

/** How long the code rests before it is checked. */
export const CHECK_DELAY_MS = 600;

export type EditorView = "outline" | "both" | "code";

const VIEWS: readonly { view: EditorView; label: string }[] = [
  { view: "outline", label: "Outline" },
  { view: "both", label: "Both" },
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
  /** Opens the file's folder in Finder. Without it, the action is not offered. */
  onReveal?: (path: string) => Promise<void>;
  /** Told whenever the text differs from the saved one, or stops doing so. */
  onDirtyChange?: (dirty: boolean) => void;
  /** A state to start in, for the gallery and tests. */
  initial?: { text?: string; steps?: readonly WorkflowOutlineStep[]; problems?: readonly WorkflowProblem[]; selected?: string; view?: EditorView; saveError?: string };
};

function ProblemMark({ problem }: { problem: WorkflowProblem }) {
  return <span aria-hidden="true">{problem.severity === "error" ? "✕" : "!"}</span>;
}

function whereText(problem: WorkflowProblem, steps: readonly WorkflowOutlineStep[]): string {
  const at = problem.step_id === null || problem.step_id === undefined ? -1 : steps.findIndex((step) => step.id === problem.step_id);
  return at < 0 ? `line ${problem.line}` : `line ${problem.line} · step ${at + 1}`;
}

function StepCard({ step, number, selected, problems, onSelect }: { step: WorkflowOutlineStep; number: number; selected: boolean; problems: readonly WorkflowProblem[]; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={selected ? "step" : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg border bg-surface px-2.5 py-2 text-left outline-offset-2 outline-clay focus-visible:outline-2",
        selected ? "border-clay bg-clay-soft" : "border-line hover:border-line-strong",
      )}
    >
      <span className="flex items-baseline gap-2 text-sm font-medium">
        <span className={cn("w-5 shrink-0 text-right text-meta", selected ? "text-clay-ink" : "text-faint")}>{number}</span>
        <span className="min-w-0 flex-1 wrap-anywhere">{step.title}</span>
      </span>
      <span className="pl-7 text-meta text-muted wrap-anywhere">{stepNotes(step).join(" · ")}</span>
      {problems.map((problem, at) => (
        <span key={at} className={cn("pl-7 text-meta wrap-anywhere", problem.severity === "error" ? "text-deny" : "text-wait")}>
          <ProblemMark problem={problem} /> {problem.message}
        </span>
      ))}
    </button>
  );
}

function Outline({ steps, selected, problemsOf, onSelect }: { steps: readonly WorkflowOutlineStep[]; selected: string | null; problemsOf: (step: WorkflowOutlineStep) => WorkflowProblem[]; onSelect: (step: WorkflowOutlineStep) => void }) {
  if (steps.length === 0) return <p className="text-sm text-muted">No steps found in the code.</p>;
  return (
    <ol aria-label="Outline" className="flex flex-col gap-1.5">
      {steps.map((step, at) => {
        const group = step.group ?? null;
        const before = at === 0 ? null : (steps[at - 1]?.group ?? null);
        return (
          <li key={step.id} className="flex flex-col gap-1.5">
            {group !== null && group !== before ? <span className="pt-1 text-meta font-medium text-faint">{group}</span> : null}
            <div className={cn(group !== null && "border-l-2 border-line pl-2")}>
              <StepCard step={step} number={at + 1} selected={selected === step.id} problems={problemsOf(step)} onSelect={() => onSelect(step)} />
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
      <dt className="w-14 shrink-0 text-meta text-faint">{name}</dt>
      <dd className="min-w-0 flex-1 wrap-anywhere">{children}</dd>
    </div>
  );
}

function StepPane({ step, number, lines, text }: { step: WorkflowOutlineStep | null; number: number; lines: readonly string[]; text: string }) {
  if (step === null) return <p className="text-sm text-muted">Pick a step in the outline, or put the cursor in its lines.</p>;
  const range = stepRange(step);
  const brief = step.brief_line === null || step.brief_line === undefined ? null : (text.split("\n")[step.brief_line - 1]?.trim() ?? null);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-baseline gap-2 text-sm font-medium">
        <span className="text-meta text-clay-ink">{number}</span>
        <span className="wrap-anywhere">{step.title}</span>
      </h3>
      <dl className="flex flex-col gap-1.5">
        <Field name="kind">{step.kind}</Field>
        {step.agent ? <Field name="agent">{step.agent}</Field> : null}
        {brief === null ? null : (
          <Field name="brief">
            <Code tone="muted">{brief}</Code>
          </Field>
        )}
        {step.for_each ? <Field name="for each">{step.for_each}</Field> : null}
        {step.condition ? <Field name="if">{step.condition}</Field> : null}
        {step.gets ? <Field name="gets">{step.gets}</Field> : null}
        {step.key ? (
          <Field name="key">
            <Code tone="muted">{step.key}</Code>
          </Field>
        ) : null}
        {step.budget ? <Field name="budget">{step.budget}</Field> : null}
        {range === null ? null : <Field name="lines">{range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`}</Field>}
      </dl>
      {lines.length === 0 ? null : <pre aria-label="Lines of the step" className="overflow-x-auto rounded-md border border-line bg-surface p-2 font-mono text-code text-ink">{lines.join("\n")}</pre>}
      <p className="text-meta text-faint">Read only. Each field is read from the code. Change the code to change a step.</p>
    </div>
  );
}

/**
 * The Code tab of a workflow: the outline read from the code, the code with the step numbers in its margin,
 * and the selected step. Typing redraws the outline and the problems after a pause (`workflow.check`); Save
 * (or ⌘S) writes the file (`workflow.save`) against the hash the editor started from.
 */
export function WorkflowEditor({ workflow, steps: savedSteps, code, codeHash, onCheck, onSave, onReveal, onDirtyChange, initial }: WorkflowEditorProps) {
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
  const problemsOf = (step: WorkflowOutlineStep) => problems.filter((problem) => problem.step_id === step.id);

  function pick(step: WorkflowOutlineStep): void {
    setSelectedId(step.id);
    const start = stepRange(step);
    if (start !== null) setReveal({ line: start[0], nonce: (reveal?.nonce ?? 0) + 1 });
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
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      void save();
    }
  }

  const counts = problemCounts(problems);
  const hasErrors = problems.some((problem) => problem.severity === "error");
  const status = checking ? (
    <Badge>Checking…</Badge>
  ) : checkError !== null ? (
    <Badge tone="wait">Could not check</Badge>
  ) : !checked ? null : hasErrors ? (
    <Badge tone="deny">✕ {counts}</Badge>
  ) : problems.length > 0 ? (
    <Badge tone="wait">! {counts}</Badge>
  ) : (
    <Badge tone="allow">✓ checks pass</Badge>
  );
  const showCode = view !== "outline";
  const showOutline = view !== "code";
  const showStep = view !== "code";

  return (
    // The wrapper only catches ⌘S from the editor inside it.
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
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
        {readOnly ? null : (
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
      {checkError === null ? null : (
        <p role="alert" className="text-sm text-deny wrap-anywhere">
          {checkError}
        </p>
      )}
      {problems.length === 0 ? null : (
        <ul aria-label="Problems" className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg p-3 text-sm">
          {problems.map((problem, at) => (
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
                  {whereText(problem, steps)}
                </button>
                {" · "}
                {problem.message}
                {problem.fix ? <span className="text-muted"> Fix: {problem.fix}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        {showOutline ? (
          <div className="flex min-w-0 flex-col gap-2 lg:w-72 lg:shrink-0">
            <h2 className="text-meta font-medium text-faint">Outline, read from the code</h2>
            <Outline steps={steps} selected={selectedId} problemsOf={problemsOf} onSelect={pick} />
          </div>
        ) : null}
        {showCode ? (
          <div className="flex min-h-96 min-w-0 flex-1 flex-col gap-2">
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
          <div role="group" aria-label="Selected step" className="flex min-w-0 flex-col gap-2 lg:w-72 lg:shrink-0">
            <h2 className="text-meta font-medium text-faint">Step</h2>
            <StepPane step={selected} number={selectedAt} lines={range === null ? [] : lines.slice(range[0] - 1, range[1])} text={text} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
