import type { EvalMeasurement, EvalPlanArm } from "../../store/evals.ts";
import { SAVED_WORK_TEXT, armLabel, armRows, armsText, canUseNumbers, doneFooter, doneLine, progressView, proposalLines, resultTables, runRows, stoppedView, whenText, type MeasureLive, type RunRow } from "@golem/view";
import { useId, useState } from "react";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { ToneBadge } from "./measure-list.tsx";

const MARK_TONE = { done: "text-allow", failed: "text-deny", running: "text-wait", pending: "text-faint", not_run: "text-faint" } as const;

const TH = "px-2 py-1 text-left text-meta font-medium text-muted";
const TD = "px-2 py-1 text-sm text-ink";

/** The table of runs: done, running, waiting, not run. */
function RunsTable({ rows }: { rows: readonly RunRow[] }) {
  const manyArms = new Set(rows.map((row) => row.arm)).size > 1;
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
            <th scope="col" className={cn(TH, "text-right")}>
              Answer
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
          {rows.map((row) => (
            <tr key={row.key} className={cn("border-b border-line last:border-b-0", row.state === "running" && "bg-sunken", (row.state === "pending" || row.state === "not_run") && "text-faint")}>
              <td className={cn(TD, "w-6", MARK_TONE[row.state])}>
                <span aria-hidden="true">{row.mark}</span>
                <span className="sr-only">{row.state === "done" ? "done" : row.state === "pending" ? "waiting" : ""}</span>
              </td>
              <td className={TD}>
                {row.ask}
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
          ))}
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
function Running({ measurement, live, error, busy, onStop }: { measurement: EvalMeasurement; live: MeasureLive | null; error: string | null; busy: boolean; onStop: () => void }) {
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
      <RunsTable rows={runRows(measurement)} />
      <p className="text-meta text-muted">Going back, or leaving Settings, does not stop the run. It goes on in the golem service, and the Measure tab shows a dot until it ends.</p>
    </div>
  );
}

/** A stopped measurement: why, what is kept, and how to go on or let it go. */
function Stopped({ measurement, plan, error, busy, onResume, onDelete }: { measurement: EvalMeasurement; plan: readonly EvalPlanArm[]; error: string | null; busy: boolean; onResume: (allowTight: boolean) => void; onDelete: () => void }) {
  const view = stoppedView(measurement);
  const [saved, setSaved] = useState(false);
  const left = new Set(measurement.runs.filter((run) => run.end === "not_run" || run.end === "pending").map((run) => run.arm));
  // The arms the rest would play, as the plan sees them now: the same rule as for a new measurement, no override.
  const again = armRows(plan.filter((arm) => left.has(arm.name)));
  const blocked = again.some((row) => !row.canTick);
  const tight = again.some((row) => row.needsSaved);
  const ready = view.resume !== null && !blocked && (!tight || saved);
  return (
    <div className={CARD}>
      <p className="rounded-md bg-wait-soft px-3 py-2 text-sm text-wait" role="status">
        <b className="font-medium">{view.title}</b> {view.detail}
      </p>
      {blocked ? <p className="text-sm text-deny">There is not enough memory to play the rest now. Close other apps and check again from the list.</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {tight && !blocked ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="accent-clay" />
            <span>{SAVED_WORK_TEXT}</span>
          </label>
        ) : null}
        <span className="flex-1" />
        <Button kind="danger" disabled={busy} onClick={onDelete}>
          Delete this measurement
        </Button>
        {view.resume === null ? null : (
          <Button kind="primary" disabled={!ready || busy} onClick={() => onResume(tight && saved)}>
            {view.resume}
          </Button>
        )}
      </div>
      <Failure error={error} />
      <RunsTable rows={runRows(measurement)} />
    </div>
  );
}

/** A finished measurement: off against on for each ask, the four numbers it proposes, and what to do with them. */
function Done({ measurement, error, busy, onApply, onClose, onDelete }: { measurement: EvalMeasurement; error: string | null; busy: boolean; onApply: () => void; onClose: () => void; onDelete: () => void }) {
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
  onResume: (allowTight: boolean) => void;
  onApply: () => void;
  onDelete: () => void;
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
      {measurement.state === "running" ? <Running measurement={measurement} live={live} error={error} busy={busy} onStop={onStop} /> : null}
      {measurement.state === "stopped" ? <Stopped measurement={measurement} plan={plan} error={error} busy={busy} onResume={onResume} onDelete={onDelete} /> : null}
      {measurement.state === "done" ? <Done measurement={measurement} error={error} busy={busy} onApply={onApply} onClose={onBack} onDelete={onDelete} /> : null}
    </section>
  );
}
