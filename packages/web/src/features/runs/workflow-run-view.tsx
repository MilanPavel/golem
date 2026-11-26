import { stepMetaLine, stepOutputLine, stepOutputText, workerResult, workflowRunTook, workflowStepsList, type StepLike } from "@golem/view";
import { useState, type ReactNode } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { runsPath } from "../../store/router.ts";
import type { ReviewVerdict, WorkflowReviewInfo, WorkflowRunInfo, WorkflowStepInfo } from "../../store/workflows.ts";
import { Badge, type BadgeProps } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Link } from "../../ui/link.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { StepsView, type StepExtra } from "../workbench/index.ts";
import { ReviewCard } from "./review-card.tsx";

const STATUS: Record<WorkflowRunInfo["status"], { word: string; tone: NonNullable<BadgeProps["tone"]> }> = {
  pending: { word: "queued", tone: "neutral" },
  running: { word: "running", tone: "clay" },
  waiting: { word: "waiting for you", tone: "wait" },
  done: { word: "done", tone: "allow" },
  failed: { word: "failed", tone: "deny" },
  cancelled: { word: "cancelled", tone: "neutral" },
};

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
  onResume: () => Promise<unknown>;
  onAnswer: (key: string, verdict: ReviewVerdict, text?: string) => Promise<void>;
  /** The Trace tab's content. Without it the tab is not offered. */
  trace?: ReactNode;
  initialTab?: "steps" | "trace";
};

function Output({ step }: { step: WorkflowStepInfo }) {
  const text = stepOutputText(step.result);
  if (text === "") return null;
  return (
    <pre aria-label={`Output of ${step.title}`} className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-code text-ink">
      {text}
    </pre>
  );
}

function WorkerBlock({ step }: { step: WorkflowStepInfo }) {
  const worker = workerResult(step.result);
  if (worker === null) return null;
  return (
    <dl className="m-0 grid cols-label-value gap-x-3 gap-y-0.5 text-meta">
      <dt className="text-faint">Copy</dt>
      <dd className="m-0 min-w-0 truncate">
        <Code>{worker.worktree}</Code>
      </dd>
      <dt className="text-faint">Changed</dt>
      <dd className="m-0">
        {worker.files} {worker.files === 1 ? "file" : "files"}, +{worker.added} −{worker.removed}
      </dd>
      <dt className="text-faint">Checks</dt>
      <dd className="m-0">
        {worker.checks}
        {worker.checksNote === null ? "" : `: ${worker.checksNote}`}
      </dd>
    </dl>
  );
}

/** The detail line under a step's bar, and what the step unfolds: its output, its chat, its error. */
function stepExtra(step: WorkflowStepInfo, props: Pick<WorkflowRunViewProps, "run" | "chatPath" | "onNavigate" | "onResume">, resume: ReactNode): StepExtra {
  const output = stepOutputLine(step);
  const meta = stepMetaLine(step);
  const detail = (
    <>
      <span className="text-faint">{meta}</span>
      {step.status === "failed" && step.error !== null && step.error !== undefined ? <span className="block truncate text-deny">{step.error}</span> : output === "" ? null : <span className="block truncate">{output}</span>}
    </>
  );
  const hasResult = step.result !== null && step.result !== undefined;
  const child = step.child_session_id;
  const failed = step.status === "failed" || step.status === "in_doubt";
  if (!hasResult && child === null && !failed) return { detail };
  return {
    detail,
    open: (
      <div className="flex flex-col gap-2">
        {failed && step.error !== null && step.error !== undefined ? <p className="m-0 text-sm break-words text-deny">{step.error}</p> : null}
        <WorkerBlock step={step} />
        <Output step={step} />
        <div className="flex flex-wrap items-center gap-3">
          {child === null || child === undefined ? null : (
            <Link href={props.chatPath(child)} onNavigate={props.onNavigate} className={LINK}>
              Open chat
            </Link>
          )}
          {step.status === "failed" ? resume : null}
        </div>
      </div>
    ),
  };
}

function StepsPanel(props: WorkflowRunViewProps & { resume: ReactNode }) {
  const { steps, now } = props;
  if (steps.length === 0) return <p className="text-sm text-muted">No step has started yet.</p>;
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const list = workflowStepsList(steps as readonly StepLike[], now);
  return (
    <>
      <h2 className="sr-only">Steps of the run</h2>
      <StepsView
        batches={[{ callId: props.run.workflow_run_id, head: `${props.run.name} · ${STATUS[props.run.status].word}`, list, refs: [] }]}
        extra={(row) => {
          const step = byKey.get(row.id);
          return step === undefined ? undefined : stepExtra(step, props, props.resume);
        }}
      />
    </>
  );
}

/**
 * One workflow run: its state and what you can do (Cancel, Resume), the reviews it waits on as cards, and the
 * steps with their time bars, each opening its output. The trace is a tab of its own. Pure: it takes the run as
 * `workflow.status` sent it, and the actions come in as callbacks.
 */
export function WorkflowRunView(props: WorkflowRunViewProps) {
  const { run, reviews, now, onNavigate, onCancel, onResume, trace, initialTab = "steps" } = props;
  const [tab, setTab] = useState<"steps" | "trace">(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS[run.status];
  const took = workflowRunTook(run, now);
  const live = run.status === "running" || run.status === "waiting" || run.status === "pending";

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
  const resume = (
    <Button size="sm" kind="primary" disabled={busy} onClick={() => void act(onResume, "The run did not resume.")}>
      Resume from here
    </Button>
  );

  return (
    <div className="flex min-w-0 max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap-reverse items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
          <Link href={runsPath()} onNavigate={onNavigate} className={`${LINK} text-meta`}>
            All runs
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 font-ui text-lg font-semibold">
            <span className="min-w-0 truncate">{run.name}</span>
            <Badge tone={status.tone}>{status.word}</Badge>
          </h1>
          <p className="text-meta text-muted">
            {run.trigger}
            {run.started_at === null || run.started_at === undefined ? "" : ` · started ${new Date(run.started_at).toLocaleString()}`}
            {took === "" ? "" : ` · ${took}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.status === "failed" ? (
            <Button kind="primary" disabled={busy} onClick={() => void act(onResume, "The run did not resume.")}>
              Resume
            </Button>
          ) : null}
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
      {reviews.map((review) => (
        <ReviewCard key={review.key} review={review} onAnswer={props.onAnswer} />
      ))}
      <Tabs value={tab} onValueChange={(next) => setTab(next as "steps" | "trace")} className="flex flex-col gap-4">
        <TabsList aria-label={`${run.name} run`}>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          {trace === undefined ? null : <TabsTrigger value="trace">Trace</TabsTrigger>}
        </TabsList>
        <TabsContent value="steps">
          <StepsPanel {...props} resume={resume} />
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
