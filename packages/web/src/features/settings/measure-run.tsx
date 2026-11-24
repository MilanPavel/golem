import type { EvalMeasurement, EvalPlanArm } from "../../store/evals.ts";
import { ANSWER_HINT, armLabel, armRows, armsText, canUseNumbers, doneFooter, doneLine, paramsView, progressView, proposalLines, resultTables, resumePlan, runRows, stoppedView, whenText, type FactMark, type MeasureLive, type RunRow } from "@golem/view";
import { Fragment, useId, useState } from "react";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { ToneBadge } from "./measure-list.tsx";

const MARK_TONE = { done: "text-allow", failed: "text-deny", running: "text-wait", pending: "text-faint", not_run: "text-faint" } as const;

const TH = "px-2 py-1 text-left text-meta font-medium text-muted";
const TD = "px-2 py-1 text-sm text-ink";

const FACT_MARK: Record<FactMark["mark"], { mark: string; word: string; tone: string }> = {
  found: { mark: "✓", word: "found", tone: "text-allow" },
  missing: { mark: "✗", word: "missing", tone: "text-deny" },
  unknown: { mark: "–", word: "not checked", tone: "text-faint" },
};

/** What was asked and what came back: the message, the set-up, the facts the answer must mention, and the answer kept. */
function RunDetails({ row, id }: { row: RunRow; id: string }) {
  const detail = row.detail;
  if (detail === null) return null;
  return (
    <div id={id} className="flex flex-col gap-2 py-1 text-sm">
      <p className="text-ink">
        <span className="text-meta text-muted">The message: </span>&ldquo;{detail.message}&rdquo;
      </p>
      <p className="text-meta text-muted">{[detail.setup, detail.why].filter((part) => part !== "").join(" · ")}</p>
      <div>
        <span className="text-meta text-muted">The answer must mention:</span>
        <ul aria-label="Facts the answer must mention" className="flex flex-wrap gap-x-4 gap-y-0.5">
          {detail.facts.map((fact) => (
            <li key={fact.text} className="flex items-center gap-1 text-ink">
              <span aria-hidden="true" className={FACT_MARK[fact.mark].tone}>
                {FACT_MARK[fact.mark].mark}
              </span>
              {fact.text}
              <span className="sr-only">{FACT_MARK[fact.mark].word}</span>
            </li>
          ))}
        </ul>
      </div>
      {detail.answer === null ? (
        <p className="text-meta text-faint">No answer was kept for this run.</p>
      ) : (
        <div>
          <span className="text-meta text-muted">The model&rsquo;s answer:</span>
          <pre className="mt-0.5 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg px-3 py-2 text-xs text-ink">{detail.answer}</pre>
        </div>
      )}
    </div>
  );
}

/** Above the table: what the measurement ran with, as one disclosure. */
function Parameters({ measurement, open = false }: { measurement: EvalMeasurement; open?: boolean }) {
  const view = paramsView(measurement);
  return (
    <details open={open} className="rounded-md border border-line bg-bg px-3 py-2">
      <summary className="cursor-pointer text-sm text-ink outline-offset-2 outline-clay focus-visible:outline-2">{view.label}</summary>
      <ul aria-label="Parameters of the measurement" className="mt-2 flex flex-col gap-1 text-sm text-muted">
        {view.arms.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {view.rules === null ? null : <li>{view.rules}</li>}
        {view.version === null ? null : <li>{view.version}</li>}
        {view.ownRisk ? <li className="text-wait">Started at your own risk.</li> : null}
      </ul>
    </details>
  );
}

/** The table of runs: done, running, waiting, not run. A row that has its ask opens to what was asked and answered. */
function RunsTable({ rows, firstOpen = false }: { rows: readonly RunRow[]; firstOpen?: boolean }) {
  const manyArms = new Set(rows.map((row) => row.arm)).size > 1;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(firstOpen ? rows.filter((row) => row.detail !== null && row.state === "done").slice(0, 1).map((row) => row.key) : []));
  const base = useId();
  const toggle = (key: string): void => {
    setOpen((before) => {
      const next = new Set(before);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
    <div className="overflow-x-auto">
      <table aria-label="Runs" className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={TH}>
              <span className="sr-only">State</span>
            </th>
            <th scope="col" className={TH}>
              Ask
            </th>
            <th scope="col" className={TH}>
              Helpers
            </th>
            <th scope="col" title={ANSWER_HINT} className={cn(TH, "text-right")}>
              Answer <span className="text-faint">(0–1)</span>
              <span className="sr-only">. {ANSWER_HINT}</span>
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Time
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Window left
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Started
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const shown = open.has(row.key);
            const panel = `${base}-${row.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
            return (
              <Fragment key={row.key}>
            <tr className={cn("border-b border-line last:border-b-0", row.state === "running" && "bg-sunken", (row.state === "pending" || row.state === "not_run") && "text-faint")}>
              <td className={cn(TD, "w-6", MARK_TONE[row.state])}>
                <span aria-hidden="true">{row.mark}</span>
                <span className="sr-only">{row.state === "done" ? "done" : row.state === "pending" ? "waiting" : ""}</span>
              </td>
              <td className={TD}>
                {row.detail === null ? (
                  row.ask
                ) : (
                  <button type="button" aria-expanded={shown} aria-controls={shown ? panel : undefined} onClick={() => toggle(row.key)} className="text-left outline-offset-2 outline-clay hover:underline focus-visible:outline-2">
                    <span aria-hidden="true" className="text-muted">
                      {shown ? "▾ " : "▸ "}
                    </span>
                    {row.ask}
                  </button>
                )}
                {manyArms ? <span className="text-meta text-muted"> · {armLabel(row.arm)}</span> : null}
              </td>
              <td className={TD}>{row.helpers}</td>
              {row.word === "" ? (
                <>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.answer}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.time}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.windowLeft}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.started}</td>
                </>
              ) : (
                <td colSpan={4} className={cn(TD, "text-right text-muted")}>
                  {row.word}
                </td>
              )}
            </tr>
            {shown ? (
              <tr className="border-b border-line bg-sunken last:border-b-0">
                <td />
                <td colSpan={6} className="px-2 py-1">
                  <RunDetails row={row} id={panel} />
                </td>
              </tr>
            ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The row with "‹ All measurements" and what this measurement is. */
function BackRow({ measurement, onBack, now }: { measurement: EvalMeasurement; onBack: () => void; now?: Date }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button kind="ghost" size="sm" onClick={onBack}>
        ‹ All measurements
      </Button>
      <span className="text-sm text-muted">
        {whenText(measurement.started_at, now ?? new Date())} · {armsText(measurement.arms)}
      </span>
    </div>
  );
}

function Failure({ error }: { error: string | null }) {
  return error === null ? null : (
    <p role="alert" className="text-sm text-deny">
      {error}
    </p>
  );
}

const CARD = "flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3";

/** A measurement that runs: which run, the bar, the memory, the runs so far, and Stop. */
function Running({ measurement, live, error, busy, firstOpen, onStop }: { measurement: EvalMeasurement; live: MeasureLive | null; error: string | null; busy: boolean; firstOpen: boolean; onStop: () => void }) {
  const view = progressView(measurement, live);
  const percent = Math.round(view.share * 100);
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <b className="text-sm font-medium text-ink">{view.title}</b>
        <span className="text-sm text-muted">{view.what}</span>
        <span className="flex-1" />
        <span className="text-sm text-muted">{view.time}</span>
        <Button kind="danger" size="sm" disabled={busy} onClick={onStop}>
          Stop
        </Button>
      </div>
      <div role="progressbar" aria-label="Progress of the measurement" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 w-full overflow-hidden rounded-full bg-line-strong">
        <div className="h-full rounded-full bg-clay" style={{ width: `${percent}%` }} />
      </div>
      {view.memory === null ? null : (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>Memory</span>
          <div role="img" aria-label={`Memory ${view.memory}`} className="h-1.5 w-full max-w-64 overflow-hidden rounded-full bg-line-strong">
            <div className="h-full bg-faint" style={{ width: `${Math.round((view.memoryShare ?? 0) * 100)}%` }} />
          </div>
          <span className="text-meta">{view.memory}</span>
        </div>
      )}
      <Failure error={error} />
      <Parameters measurement={measurement} open={firstOpen} />
      <RunsTable rows={runRows(measurement)} firstOpen={firstOpen} />
      <p className="text-meta text-muted">Going back, or leaving Settings, does not stop the run. It goes on in the golem service, and the Measure tab shows a dot until it ends.</p>
    </div>
  );
}

/** A stopped measurement: why, what is kept, and how to go on or let it go. */
function Stopped({ measurement, plan, error, busy, firstOpen, onResume, onDelete }: { measurement: EvalMeasurement; plan: readonly EvalPlanArm[]; error: string | null; busy: boolean; firstOpen: boolean; onResume: (allowTight: boolean, ownRisk: boolean) => void; onDelete: () => void }) {
  const view = stoppedView(measurement);
  const [saved, setSaved] = useState(false);
  const left = new Set(measurement.runs.filter((run) => run.end === "not_run" || run.end === "pending").map((run) => run.arm));
  // The arms the rest would play, as the plan sees them now: the same rule as for a new measurement. Memory warns, never blocks.
  const again = resumePlan(armRows(plan.filter((arm) => left.has(arm.name))), saved);
  const ready = view.resume !== null && again.ready;
  return (
    <div className={CARD}>
      <p className="rounded-md bg-wait-soft px-3 py-2 text-sm text-wait" role="status">
        <b className="font-medium">{view.title}</b> {view.detail}
      </p>
      {again.warning === null ? null : (
        <p className="rounded-md bg-wait-soft px-3 py-2 text-sm text-wait" role="status">
          <b className="font-medium">Warning.</b> {again.warning}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {again.needsSaved ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="accent-clay" />
            <span>{again.confirm}</span>
          </label>
        ) : null}
        <span className="flex-1" />
        <Button kind="danger" disabled={busy} onClick={onDelete}>
          Delete this measurement
        </Button>
        {view.resume === null ? null : (
          <Button kind="primary" disabled={!ready || busy} onClick={() => onResume(again.allowTight, again.ownRisk)}>
            {view.resume}
          </Button>
        )}
      </div>
      <Failure error={error} />
      <Parameters measurement={measurement} open={firstOpen} />
      <RunsTable rows={runRows(measurement)} firstOpen={firstOpen} />
    </div>
  );
}

/** A finished measurement: off against on for each ask, the four numbers it proposes, and what to do with them. */
function Done({ measurement, error, busy, firstOpen, onApply, onClose, onDelete }: { measurement: EvalMeasurement; error: string | null; busy: boolean; firstOpen: boolean; onApply: () => void; onClose: () => void; onDelete: () => void }) {
  const line = doneLine(measurement);
  const tables = resultTables(measurement);
  const lines = proposalLines(measurement);
  const use = canUseNumbers(measurement);
  return (
    <div className={CARD}>
      <p className="rounded-md bg-allow-soft px-3 py-2 text-sm text-allow" role="status">
        <b className="font-medium">{line.title}</b> {line.detail}
      </p>
      {tables.map((table) => (
        <div key={table.arm} className="overflow-x-auto">
          <table aria-label={tables.length > 1 ? `Result, ${table.title}` : "Result"} className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>
                  Ask
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Answer off → on
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Time off → on
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Window left off → on
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Helpers
                </th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Verdict</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.ask} className="border-b border-line last:border-b-0">
                  <td className={TD}>
                    {row.ask}
                    {tables.length > 1 ? <span className="text-meta text-muted"> · {table.title}</span> : null}
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.answer}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.time}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.windowLeft}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{row.helpers}</td>
                  <td className={TD}>
                    <ToneBadge tone={row.verdict.tone}>{row.verdict.text}</ToneBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <Parameters measurement={measurement} open={firstOpen} />
      <details open={firstOpen} className="rounded-md border border-line bg-bg px-3 py-2">
        <summary className="cursor-pointer text-sm text-ink outline-offset-2 outline-clay focus-visible:outline-2">All runs, with what was asked</summary>
        <div className="mt-2">
          <RunsTable rows={runRows(measurement)} firstOpen={firstOpen} />
        </div>
      </details>
      {lines.length === 0 ? null : (
        <ul aria-label="Proposed numbers" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {lines.map((each) => (
            <li key={each.key} className={"flex flex-col gap-0.5 rounded-md border border-line bg-bg px-3 py-2"}>
              <Code tone="muted" className="text-xs">{each.key}</Code>
              <span className="text-sm text-ink">
                <s className="text-faint">{each.current}</s> <b className={cn("font-medium", each.proposed === null && "text-faint")}>{each.proposed ?? "not measured"}</b>
              </span>
              <span className="text-meta text-muted">{each.note}</span>
            </li>
          ))}
        </ul>
      )}
      <Failure error={error} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex-1 text-sm text-muted">{doneFooter(measurement)}</span>
        <Button kind="danger" disabled={busy} onClick={onDelete}>
          Delete
        </Button>
        <Button disabled={busy} onClick={onClose}>
          {measurement.in_use === true ? "Close" : "Keep mine and close"}
        </Button>
        {use ? (
          <Button kind="primary" disabled={busy} onClick={onApply}>
            Use these numbers
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** One measurement, opened from the list: running, stopped or done. */
export function MeasureRunView({
  measurement,
  live,
  plan,
  error,
  busy = false,
  now,
  onBack,
  onStop,
  onResume,
  onApply,
  onDelete,
  firstOpen = false,
}: {
  /** Null while it is read. */
  measurement: EvalMeasurement | null;
  live: MeasureLive | null;
  plan: readonly EvalPlanArm[];
  error: string | null;
  busy?: boolean;
  now?: Date;
  onBack: () => void;
  onStop: () => void;
  onResume: (allowTight: boolean, ownRisk: boolean) => void;
  onApply: () => void;
  onDelete: () => void;
  /** The first finished run shown open, with the parameters, for the gallery. */
  firstOpen?: boolean;
}) {
  const heading = useId();
  if (measurement === null) {
    return (
      <div className="flex max-w-column flex-col gap-3">
        <div>
          <Button kind="ghost" size="sm" onClick={onBack}>
            ‹ All measurements
          </Button>
        </div>
        {error === null ? <p className="text-sm text-muted">asking the daemon…</p> : <Failure error={error} />}
      </div>
    );
  }
  return (
    <section aria-labelledby={heading} className="flex max-w-column flex-col gap-3">
      <h3 id={heading} className="sr-only">
        Measurement
      </h3>
      <BackRow measurement={measurement} onBack={onBack} now={now} />
      {measurement.state === "running" ? <Running measurement={measurement} live={live} error={error} busy={busy} firstOpen={firstOpen} onStop={onStop} /> : null}
      {measurement.state === "stopped" ? <Stopped measurement={measurement} plan={plan} error={error} busy={busy} firstOpen={firstOpen} onResume={onResume} onDelete={onDelete} /> : null}
      {measurement.state === "done" ? <Done measurement={measurement} error={error} busy={busy} firstOpen={firstOpen} onApply={onApply} onClose={onBack} onDelete={onDelete} /> : null}
    </section>
  );
}
