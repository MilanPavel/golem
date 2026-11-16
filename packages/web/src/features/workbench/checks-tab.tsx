import { checkSeconds, checksSummary, type CheckRun, type ChecksState, type ChecksTone, type TurnChecks } from "@golem/view";
import { useId, useState, type ReactNode } from "react";
import { useArtifact, usePageActions, useSession } from "../../store/page-context.tsx";
import { actionErrorText } from "../../store/errors.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";

/** Characters of a check's output the tab shows. The event carries no more. */
export const OUTPUT_CHARS = 4000;

const STATUS: Record<CheckRun["status"], { label: string; tone: "allow" | "deny" | "wait" }> = {
  running: { label: "running", tone: "wait" },
  passed: { label: "passed", tone: "allow" },
  failed: { label: "failed", tone: "deny" },
  timed_out: { label: "timed out", tone: "deny" },
};

const OUTPUT_BOX = "relative max-h-72 overflow-auto rounded-sm bg-code-bg p-2.5 font-mono text-xs whitespace-pre-wrap wrap-anywhere";

/** What the tab badge says for the newest turn: `✓`, `✗`, or nothing while checks run or have not run. */
export function checksBadge(checks: ChecksState, running: string | null): string | undefined {
  const newest = checks.turns.at(-1);
  if (newest === undefined) return undefined;
  const { tone } = checksSummary(newest, newest.runId === running);
  return tone === "ok" ? "✓" : tone === "bad" ? "✗" : undefined;
}

/** A check: its name, command, status and time, and the end of its output. Read all shows the whole of it. */
function CheckBlock({ run, readAll }: { run: CheckRun; readAll: (run: CheckRun) => ReactNode }) {
  const [all, setAll] = useState(false);
  const status = STATUS[run.status];
  const output = run.output.length > OUTPUT_CHARS ? run.output.slice(-OUTPUT_CHARS) : run.output;
  return (
    <li data-check={run.checkId} className="flex min-w-0 flex-col gap-1.5 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{run.name}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
        {run.durationMs === null ? null : <span className="font-mono text-xs text-muted">{checkSeconds(run.durationMs)}</span>}
        {run.round > 0 ? <span className="font-mono text-xs text-faint">{`round ${run.round + 1}`}</span> : null}
      </div>
      {run.command === "" ? null : <code className="min-w-0 truncate font-mono text-xs text-muted" title={run.command}>{run.command}</code>}
      {all && run.artifactId !== null ? (
        readAll(run)
      ) : output === "" ? (
        run.status === "running" ? null : <p className="text-xs text-faint">No output.</p>
      ) : (
        <pre tabIndex={0} aria-label={`Output of ${run.name}`} className={OUTPUT_BOX}>
          {output}
        </pre>
      )}
      {run.artifactId !== null && !all ? (
        <div>
          <Button
            size="sm"
            onClick={() => {
              setAll(true);
            }}
          >
            Read all
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function Blocks({ turn, readAll }: { turn: TurnChecks; readAll: (run: CheckRun) => ReactNode }) {
  return (
    <ul aria-label="Checks" className="flex list-none flex-col gap-2 p-0">
      {turn.runs.map((run) => (
        <CheckBlock key={run.checkId} run={run} readAll={readAll} />
      ))}
    </ul>
  );
}

const TONE: Record<ChecksTone, string> = { run: "text-wait", ok: "text-allow", bad: "text-deny" };

/** The switch that lets golem run the checks after its edits. Off until the session says yes. */
function AllowSwitch({ allowed, onChange, error }: { allowed: boolean | null; onChange: (on: boolean) => void; error: string | null }) {
  const on = allowed === true;
  const label = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span id={label} className="text-sm">Run checks after edits</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={label}
          onClick={() => {
            onChange(!on);
          }}
          className={cn(
            "relative h-5 w-9 shrink-0 cursor-pointer rounded-full border border-line-strong outline-offset-2 outline-clay focus-visible:outline-2",
            on ? "bg-allow-soft" : "bg-sunken",
          )}
        >
          <span aria-hidden="true" className={cn("absolute top-0.5 size-3.5 rounded-full transition-all motion-reduce:transition-none", on ? "left-4.5 bg-allow" : "left-0.5 bg-muted")} />
        </button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {error}
        </p>
      )}
    </div>
  );
}

type ChecksViewProps = {
  checks: ChecksState;
  /** The run in progress, so a failure it is fixing reads as such. */
  running: string | null;
  onAllow: (on: boolean) => void;
  /** An answer the daemon refused. */
  error: string | null;
  /** The whole output of a check whose artifact was asked for. */
  readAll: (run: CheckRun) => ReactNode;
};

/** The newest turn's checks, one block each, the older turns folded below, and the switch. It reads nothing itself. */
export function ChecksView({ checks, running, onAllow, error, readAll }: ChecksViewProps) {
  const newest = checks.turns.at(-1);
  const older = checks.turns.slice(0, -1).reverse();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <AllowSwitch allowed={checks.allowed} onChange={onAllow} error={error} />
      {newest === undefined ? (
        <p className="text-sm text-muted">No checks yet. They run after golem edits files, once you say they may.</p>
      ) : (
        <>
          {(() => {
            const summary = checksSummary(newest, newest.runId === running);
            return (
              <p className={cn("font-mono text-xs", TONE[summary.tone])}>
                <span className="font-medium">{summary.text}</span>
                {summary.detail === "" ? null : ` · ${summary.detail}`}
              </p>
            );
          })()}
          <Blocks turn={newest} readAll={readAll} />
        </>
      )}
      {older.length === 0 ? null : (
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <p className="text-xs text-muted">Earlier turns</p>
          {older.map((turn) => {
            const summary = checksSummary(turn, false);
            return (
              <details key={turn.runId} data-turn={turn.runId} className="group">
                <summary className="cursor-pointer rounded-sm px-1 py-1 font-mono text-xs outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2">
                  <span className={TONE[summary.tone]}>{summary.text}</span>
                  {summary.detail === "" ? null : <span className="text-muted">{` · ${summary.detail}`}</span>}
                </summary>
                <div className="mt-2">
                  <Blocks turn={turn} readAll={readAll} />
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The whole output of a check, from its artifact, a page at a time. */
function ArtifactText({ sessionId, run }: { sessionId: string; run: CheckRun }) {
  const query = useArtifact(sessionId, run.artifactId ?? "", run.artifactId !== null);
  if (query.isPending) {
    return (
      <p role="status" className="text-xs text-muted">
        Reading the output…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-xs text-deny">
        {query.error.message}
      </p>
    );
  }
  const text = query.data.pages.map((page) => page.text).join("");
  return (
    <>
      <pre tabIndex={0} aria-label={`Full output of ${run.name}`} className={OUTPUT_BOX}>
        {text}
      </pre>
      {query.hasNextPage ? (
        <div>
          <Button size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Show more
          </Button>
        </div>
      ) : null}
    </>
  );
}

const selectChecks = (view: { chat: { checks: ChecksState } }) => view.chat.checks;
const selectRunning = (view: { chat: { busy: boolean; runId: string | null } }) => (view.chat.busy ? view.chat.runId : null);

/** The Checks tab: the newest turn's checks with their output, and the switch for running them. */
export function ChecksTab({ sessionId }: { sessionId: string }) {
  const checks = useSession(sessionId, selectChecks);
  const running = useSession(sessionId, selectRunning);
  const actions = usePageActions();
  const [error, setError] = useState<string | null>(null);
  return (
    <ChecksView
      checks={checks}
      running={running}
      error={error}
      onAllow={(on) => {
        setError(null);
        actions.setChecks(sessionId, on).catch((failure: unknown) => {
          setError(actionErrorText(failure, "Could not change the checks."));
        });
      }}
      readAll={(run) => <ArtifactText sessionId={sessionId} run={run} />}
    />
  );
}
