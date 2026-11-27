import { FILE_CHANGED_WORDS, foldSteps, foundSoFar, liveLines, liveTexts, reuseNote, reusedWords, RUN_AGAIN_WORDS, runAgainFromWords, stepMetaLine, stepOutputLine, stepsProgress, stepTook, usualWords, workflowRunTook, type LiveLine } from "@golem/view";
import { useRef, useState, type ReactNode } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { runPath, runsPath } from "../../store/router.ts";
import type { ReviewVerdict, WorkflowReadOutputResult, WorkflowReviewInfo, WorkflowRunInfo, WorkflowStepInfo } from "../../store/workflows.ts";
import { Badge, type BadgeProps } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { Link } from "../../ui/link.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { LivePane } from "./live-pane.tsx";
import { ResultView } from "./result-view.tsx";
import { ReviewCard } from "./review-card.tsx";
import { RunResult, runOutputs } from "./run-result.tsx";
import { RESULT_KEY, RunSteps } from "./run-steps.tsx";

const STATUS: Record<WorkflowRunInfo["status"], { word: string; tone: NonNullable<BadgeProps["tone"]> }> = {
  pending: { word: "queued", tone: "neutral" },
  running: { word: "running", tone: "clay" },
  waiting: { word: "waiting for you", tone: "wait" },
  done: { word: "done", tone: "allow" },
  failed: { word: "failed", tone: "deny" },
  cancelled: { word: "cancelled", tone: "neutral" },
};

const MODEL_KINDS: readonly string[] = ["llm", "agent", "skill"];

/** "Resume with another model…": a list of the models you have set up; picking one resumes the run on it. */
function ResumeWithModel({ models, disabled, onPick }: { models: readonly string[]; disabled: boolean; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger disabled={disabled} className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs text-ink outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2 disabled:cursor-default disabled:opacity-60">
        Resume with another model…
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Resume with another model" className="flex w-72 flex-col gap-1">
        <p className="px-1 text-meta font-medium text-faint">Every model step of this run uses it from now on</p>
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {models.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPick(name);
                }}
                className="flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-sm text-ink outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2"
              >
                <Code tone="inherit" className="min-w-0 flex-1 truncate">
                  {name}
                </Code>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const LINK = "text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2";

export type WorkflowRunViewProps = {
  run: WorkflowRunInfo;
  steps: readonly WorkflowStepInfo[];
  /** The reviews that wait, each with its whole draft. */
  reviews: readonly WorkflowReviewInfo[];
  now: number;
  /** The path of a step's helper session as a chat, or null when the run has no session to open it from. */
  chatPath: (childSessionId: string) => string;
  onNavigate: (path: string) => void;
  onCancel: () => Promise<unknown>;
  /** Continues the run. With a model, from now on this run uses it (it beats the steps' and the workflow's). */
  onResume: (model?: string) => Promise<unknown>;
  /** The names of the models you have set up. Without them "Resume with another model…" is not offered. */
  models?: readonly string[];
  onAnswer: (key: string, verdict: ReviewVerdict, text?: string) => Promise<void>;
  /** The text of output `index` when it is a file path the run marked (`workflow.read_output`). Without it a file is shown as its path. */
  onReadOutput?: (index: number) => Promise<WorkflowReadOutputResult>;
  /** Asks golem a question about the run (the Ask golem path of the workflow page) and resolves with its answer. Without it "Why did this fail?" is not offered. */
  onAsk?: (question: string) => Promise<string>;
  /** Shows the file of result `index` in Finder. Without it "Show in Finder" is not offered. */
  onReveal?: (path: string, index: number) => Promise<void>;
  /** Starts a new chat with this text in its box ("Ask about this" on a result). Without it the action is not offered. */
  onAskAbout?: (text: string) => void;
  /** Opens the workflow page with this step of the run selected. Without it the link is not offered. */
  onSeeStep?: (step: WorkflowStepInfo) => void;
  /** Starts a new run from this step ("Run again from here") and opens it. Without it, or while the run goes on, the action is not offered. It rejects with the daemon's reason. */
  onRunAgain?: (step: WorkflowStepInfo) => Promise<unknown>;
  /** The Trace tab's content. Without it the tab is not offered. */
  trace?: ReactNode;
  initialTab?: "steps" | "trace";
  /** The row selected at first: `result` or a step's key. A failed run starts on its failed step. */
  initialSelected?: string;
};

/** The sentence the ask carries: the question, and the failed step with its reason, so golem has what it needs. */
export function whyQuestion(run: Pick<WorkflowRunInfo, "error">, steps: readonly WorkflowStepInfo[]): string {
  const failed = steps.find((step) => step.status === "failed" || step.status === "in_doubt");
  const reason = failed?.error ?? run.error ?? null;
  const where = failed === undefined ? "" : ` The step "${failed.title}"${failed.item ? ` (${failed.item})` : ""} failed`;
  return `Why did this fail?${where}${reason === null ? "." : failed === undefined ? ` The run failed with: ${reason}` : ` with: ${reason}`} Explain it and what to do; change nothing.`;
}

const money = (usd: number): string => (usd === 0 ? "$0" : `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`);

/** Who started it, when, how long, which models and what it cost, as the run's facts. */
function facts(run: WorkflowRunInfo, steps: readonly WorkflowStepInfo[], now: number): string {
  const took = workflowRunTook(run, now);
  const usual = run.status === "running" ? usualWords(run.usual_ms) : "";
  const models = [...new Set(steps.map((step) => step.model).filter((model): model is string => model !== null && model !== undefined && model !== ""))];
  const costs = steps.map((step) => step.cost_usd).filter((cost): cost is number => cost !== null && cost !== undefined);
  return [
    run.trigger,
    run.started_at === null || run.started_at === undefined ? "" : `started ${new Date(run.started_at).toLocaleString()}`,
    took,
    usual,
    models.join(", "),
    costs.length === 0 ? "" : money(costs.reduce((sum, cost) => sum + cost, 0)),
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** One step shown in the place of the result: what it is, its output with Readable / Raw, its chat and Resume. */
function StepPane({ step, now, resume, again, reusedWhen, props }: { step: WorkflowStepInfo; now: number; resume: ReactNode; again: ReactNode; reusedWhen: string | null; props: Pick<WorkflowRunViewProps, "chatPath" | "onNavigate" | "onSeeStep"> }) {
  const took = stepTook(step, now);
  const child = step.child_session_id;
  const failed = step.status === "failed" || step.status === "in_doubt";
  return (
    <div role="group" aria-label={`Step ${step.title}`} className="flex flex-col gap-2">
      <h3 className="m-0 flex flex-wrap items-baseline gap-2 text-sm font-medium">
        {step.title}
        {step.item ? <Code tone="muted">{step.item}</Code> : null}
      </h3>
      <p className="m-0 text-meta text-faint">{[stepMetaLine(step), took === "" ? "" : `took ${took}`, reusedWhen !== null && step.reused_from !== null && step.reused_from !== undefined ? reusedWords(reusedWhen) : ""].filter((part) => part !== "").join(" · ")}</p>
      {failed && step.error !== null && step.error !== undefined ? <p className="m-0 text-sm break-words text-deny">{step.error}</p> : null}
      {step.result === null || step.result === undefined ? <p className="m-0 text-meta text-muted">{step.status === "running" ? "Working. Its result shows here when it is done." : step.status === "pending" ? "Not started yet." : "This step has no result."}</p> : <ResultView result={step.result} label={`Output of ${step.title}`} />}
      <div className="flex flex-wrap items-center gap-3">
        {child === null || child === undefined ? null : (
          <Link href={props.chatPath(child)} onNavigate={props.onNavigate} className={LINK}>
            Open chat
          </Link>
        )}
        {props.onSeeStep === undefined ? null : (
          <button type="button" onClick={() => props.onSeeStep?.(step)} className={LINK}>
            See this step in the workflow
          </button>
        )}
        {again}
        {step.status === "failed" ? resume : null}
      </div>
    </div>
  );
}

/**
 * The thin bar and the count of steps done of steps known; while the run goes, what works now, one line each (a group that
 * goes at once shows each of its steps). With no total to count against the words say "so far" and the bar has no end.
 */
function Progress({ done, total, known, words, current, status, working }: { done: number; total: number; known: boolean; words: string; current: string | null; status: WorkflowRunInfo["status"]; working: readonly LiveLine[] }) {
  const live = status === "running" || status === "waiting" || status === "pending";
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const fill = status === "failed" ? "bg-deny" : status === "done" ? "bg-allow" : "bg-clay";
  const open = live && !known;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-sm">
        <span className="font-medium">{words}</span>
        {live && current !== null && working.length === 0 ? <span className="text-muted"> · {current}</span> : null}
      </p>
      {open ? (
        <div role="progressbar" aria-label="Steps done" aria-valuetext={words} className="h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
        </div>
      ) : (
        <div role="progressbar" aria-label="Steps done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="h-1 overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
        </div>
      )}
      {live && working.length > 0 ? (
        <ul aria-label="Working now" className="m-0 flex list-none flex-col gap-0.5 p-0 text-meta text-muted">
          {working.map((line) => (
            <li key={line.key} className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate">{line.text}</span>
              <span className="ml-auto shrink-0 text-faint">{line.took}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One workflow run as a page about its result: the workflow's title with its state and its goal, one thin bar
 * and a vertical list of steps (a loop is one row), and beside them the result by its kind, or the step you
 * picked. Reviews that wait come first. Pure: it takes the run as `workflow.status` sent it, and the actions
 * (Cancel, Resume, the file's text, the question to golem) come in as callbacks.
 */
export function WorkflowRunView(props: WorkflowRunViewProps) {
  const { run, steps, reviews, now, onNavigate, onCancel, onResume, models, onReadOutput, onAsk, trace, initialTab = "steps" } = props;
  const [tab, setTab] = useState<"steps" | "trace">(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failedStep = steps.find((step) => step.status === "failed" || step.status === "in_doubt");
  const [selected, setSelected] = useState(props.initialSelected ?? (run.status === "failed" && failedStep !== undefined ? failedStep.key : RESULT_KEY));
  const [answer, setAnswer] = useState<{ status: "asking" } | { status: "answered"; text: string } | { status: "error"; reason: string } | null>(null);
  const asked = useRef(0);
  const status = STATUS[run.status];
  const live = run.status === "running" || run.status === "waiting" || run.status === "pending";
  const rows = foldSteps(steps);
  const progress = stepsProgress(rows, { live, expected: run.steps_expected ?? null });
  const working = live ? liveLines(rows, now) : [];
  // The Live side shows a step's text as it comes, and only while one sends text.
  const texts = live ? liveTexts(steps) : [];
  const title = run.title !== null && run.title !== undefined && run.title !== "" ? run.title : run.name;
  const goal = run.description !== null && run.description !== undefined && run.description !== "" ? run.description : null;
  const summary = run.summary !== null && run.summary !== undefined && run.summary !== "" ? run.summary : null;
  const factsLine = facts(run, steps, now);
  const origin = run.from_run ?? null;
  const originWhen = origin === null || origin.started_at === null || origin.started_at === undefined ? null : new Date(origin.started_at).toLocaleString();
  const outputs = runOutputs(run);
  const picked = selected === RESULT_KEY ? null : (steps.find((step) => step.key === selected) ?? null);

  async function act(call: () => Promise<unknown>, fallback: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await call();
    } catch (caught) {
      setError(actionErrorText(caught, fallback));
    } finally {
      setBusy(false);
    }
  }
  function askWhy(): void {
    if (onAsk === undefined) return;
    asked.current += 1;
    const mine = asked.current;
    setAnswer({ status: "asking" });
    onAsk(whyQuestion(run, steps)).then(
      (text) => mine === asked.current && setAnswer({ status: "answered", text }),
      (caught: unknown) => mine === asked.current && setAnswer({ status: "error", reason: actionErrorText(caught, "golem could not answer.") }),
    );
  }
  // A run that stopped at a model step can be resumed on another model.
  const stoppedAtModel = steps.some((step) => (step.status === "failed" || step.status === "in_doubt") && MODEL_KINDS.includes(step.kind));
  const another =
    models === undefined || models.length === 0 || !stoppedAtModel ? null : <ResumeWithModel models={models} disabled={busy} onPick={(name) => void act(() => onResume(name), "The run did not resume.")} />;
  const again =
    props.onRunAgain === undefined || live || picked === null ? null : (
      <Button size="sm" disabled={busy} onClick={() => void act(() => props.onRunAgain?.(picked) ?? Promise.resolve(), "The run did not start again.")}>
        {RUN_AGAIN_WORDS}
      </Button>
    );
  const resume = (
    <>
      <Button size="sm" kind="primary" disabled={busy} onClick={() => void act(() => onResume(), "The run did not resume.")}>
        Resume from here
      </Button>
      {another}
    </>
  );

  return (
    <div className="flex min-w-0 max-w-5xl flex-col gap-4">
      <header className="flex flex-wrap-reverse items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
          <Link href={runsPath()} onNavigate={onNavigate} className={`${LINK} text-meta`}>
            All runs
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 font-ui text-lg font-semibold">
            <span className="min-w-0 truncate">{title}</span>
            <Badge tone={status.tone}>{status.word}</Badge>
          </h1>
          {goal === null ? null : (
            <p className="m-0 max-w-prose text-sm break-words text-muted">
              <span className="text-faint">Goal:</span> {goal}
            </p>
          )}
          {summary === null ? null : <p className="m-0 text-sm font-medium break-words">{summary}</p>}
          <p className="m-0 text-meta text-muted">{factsLine}</p>
          {origin === null ? null : (
            <p className="m-0 text-meta text-muted">
              <Link href={runPath(origin.workflow_run_id)} onNavigate={onNavigate} className={LINK}>
                {runAgainFromWords(origin, originWhen ?? "an earlier day")}
              </Link>
              {" · "}
              {reuseNote(origin, steps, originWhen ?? "an earlier day")}
              {origin.file_changed === true ? ` ${FILE_CHANGED_WORDS}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.status === "failed" ? (
            <>
              {onAsk === undefined ? null : <Button onClick={askWhy}>Why did this fail?</Button>}
              <Button kind="primary" disabled={busy} onClick={() => void act(() => onResume(), "The run did not resume.")}>
                Resume
              </Button>
            </>
          ) : null}
          {run.status === "failed" ? another : null}
          {live ? (
            <Button kind="danger" disabled={busy} onClick={() => void act(onCancel, "The run did not stop.")}>
              Cancel run
            </Button>
          ) : null}
        </div>
      </header>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {run.status === "failed" && run.error !== null && run.error !== undefined ? (
        <div role="alert" className="flex flex-col gap-1 rounded-lg border border-deny bg-deny-soft p-3">
          <p className="m-0 text-sm font-medium text-deny">The run failed</p>
          <p className="m-0 text-sm break-words text-ink">{run.error}</p>
        </div>
      ) : null}
      {answer === null ? null : (
        <div role="group" aria-label="Answer" className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Answer · nothing is changed</Badge>
            <span className="min-w-0 flex-1" />
            <Button
              size="sm"
              aria-label="Close"
              onClick={() => {
                asked.current += 1;
                setAnswer(null);
              }}
            >
              ✕
            </Button>
          </div>
          {answer.status === "asking" ? <p className="m-0 text-sm text-muted">golem is looking at the failed step.</p> : answer.status === "error" ? <p className="m-0 text-sm text-deny">{answer.reason}</p> : <p className="m-0 max-w-prose text-sm break-words whitespace-pre-wrap">{answer.text}</p>}
        </div>
      )}
      {reviews.map((review) => (
        <ReviewCard key={review.key} review={review} onAnswer={props.onAnswer} />
      ))}
      <Tabs value={tab} onValueChange={(next) => setTab(next as "steps" | "trace")} className="flex flex-col gap-4">
        <TabsList aria-label={`${title} run`}>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          {trace === undefined ? null : <TabsTrigger value="trace">Trace</TabsTrigger>}
        </TabsList>
        <TabsContent value="steps" className="flex flex-col gap-4">
          {steps.length === 0 ? <p className="m-0 text-sm text-muted">No step has started yet.</p> : <Progress done={progress.done} total={progress.total} known={progress.known} words={progress.words} current={progress.current} status={run.status} working={working} />}
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex min-w-0 flex-col gap-1 lg:w-80 lg:shrink-0">
              <h2 className="sr-only">Steps of the run</h2>
              <RunSteps
                rows={rows}
                now={now}
                selected={selected}
                onSelect={setSelected}
                resultWord={live ? "Live" : "Result"}
                reusedWhen={originWhen} resultLine={outputs[0]?.summary ?? (outputs.length > 0 ? stepOutputLine({ kind: "step", result: outputs[0]!.value }) : live ? "What is happening now" : "What it did")}
              />
            </div>
            <div className="min-w-0 flex-1 rounded-lg border border-line bg-bg p-4">
              {picked === null && texts.length > 0 ? <LivePane found={foundSoFar(rows)} texts={texts} /> : picked === null ? <RunResult run={run} steps={steps} onReadOutput={onReadOutput ?? (() => Promise.reject(new Error("The file cannot be read here.")))} onAskAbout={props.onAskAbout} onReveal={props.onReveal} /> : <StepPane step={picked} now={now} resume={resume} again={again} reusedWhen={originWhen} props={props} />}
            </div>
          </div>
        </TabsContent>
        {trace === undefined ? null : (
          <TabsContent value="trace" className="flex h-96 min-h-0 flex-col overflow-hidden rounded-md border border-line">
            {trace}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
