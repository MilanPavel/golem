import { CHOOSE_MODEL_TEXT, SAVED_WORK_TEXT, armRows, measureList, noRoomLine, startPlan, type ArmRow, type MeasureListRow, type MeasureTone } from "@golem/view";
import type { EvalPlanArm, EvalSummary } from "../../store/evals.ts";
import { useId, useState } from "react";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";

const BADGE: Record<MeasureTone, "allow" | "wait" | "deny" | "neutral" | "clay"> = { ok: "allow", act: "wait", bad: "deny", dim: "neutral", view: "clay" };
const TEXT: Record<MeasureTone, string> = { ok: "text-allow", act: "text-wait", bad: "text-deny", dim: "text-faint", view: "text-clay-ink" };

export function ToneBadge({ tone, children }: { tone: MeasureTone; children: string }) {
  return <Badge tone={BADGE[tone]}>{children}</Badge>;
}

/** The mark before a status: a dot while it runs, a tick when done, a square when stopped. */
export function StatusMark({ tone, mark }: { tone: MeasureTone; mark: string }) {
  return (
    <span aria-hidden="true" className={cn("w-4 shrink-0 text-center", TEXT[tone])}>
      {mark}
    </span>
  );
}

/** What others hold of the memory, then what the model needs. */
function MemoryBar({ row }: { row: ArmRow }) {
  if (row.bar === null) return null;
  const other = Math.round(row.bar.other * 100);
  const need = Math.min(100 - other, Math.round(row.bar.need * 100));
  return (
    <div role="img" aria-label={row.memoryLine} className="mt-1 flex h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-line-strong">
      <div className="h-full bg-faint" style={{ width: `${other}%` }} />
      <div className={cn("h-full", row.bar.tone === "bad" ? "bg-deny" : "bg-clay")} style={{ width: `${need}%` }} />
    </div>
  );
}

function ArmItem({ row, checked, onTick, model, onModel }: { row: ArmRow; checked: boolean; onTick: (on: boolean) => void; model: string | undefined; onModel: (model: string) => void }) {
  const id = useId();
  const why = `${id}-why`;
  // The dropdown shows the model the plan uses. A model the list does not hold shows "Choose a model", never the first entry.
  const shown = model !== undefined && row.choices.some((choice) => choice.ref === model) ? model : row.modelValue;
  return (
    <li className={cn("flex flex-col gap-1 border-t border-line py-3 first:border-t-0", !row.canTick && "opacity-90")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={!row.canTick}
          aria-describedby={why}
          onChange={(event) => onTick(event.target.checked)}
          className="mt-1 accent-clay"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <label htmlFor={id} className="text-sm font-medium text-ink">
            {row.title}
          </label>
          <span className="text-meta text-muted">{row.memoryLine}</span>
          <MemoryBar row={row} />
        </div>
        {row.choices.length > 1 || (row.choices.length === 1 && row.modelValue === "") ? (
          <select aria-label={`Model for ${row.title}`} value={shown} onChange={(event) => onModel(event.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-ink">
            {shown === "" ? (
              <option value="" disabled>
                {CHOOSE_MODEL_TEXT}
              </option>
            ) : null}
            {row.choices.map((choice) => (
              <option key={choice.ref} value={choice.ref}>
                {choice.label}
              </option>
            ))}
          </select>
        ) : (
          <Code tone="muted" className="text-xs">{row.model}</Code>
        )}
        <ToneBadge tone={row.tag.tone}>{row.tag.text}</ToneBadge>
      </div>
      <p id={why} className="pl-6 text-meta text-muted">
        {row.reason}
      </p>
    </li>
  );
}

/** One line of the list of earlier measurements, as a button that opens it. */
function HistoryRow({ row, onOpen }: { row: MeasureListRow; onOpen: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row.id)}
        aria-label={`Open the measurement of ${row.when}, ${row.status.text}`}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-0.5 rounded-md px-2 py-2 text-left text-sm outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2"
      >
        <span className="flex w-24 items-center gap-1">
          <StatusMark tone={row.status.tone} mark={row.status.mark} />
          <span className={TEXT[row.status.tone]}>{row.status.text}</span>
        </span>
        <span className="w-28 text-muted">{row.when}</span>
        <span className="min-w-0 flex-1 truncate text-ink">{row.arms}</span>
        <span className="text-meta text-muted">{row.note}</span>
        <span aria-hidden="true" className="text-muted">
          Open ›
        </span>
      </button>
    </li>
  );
}

/**
 * The list of the Measure tab: the arms of a new measurement with their memory and a verdict, the line and the Start
 * button, then the measurements kept on this Mac. An arm that is too big, or has no room now, cannot be ticked: this
 * is the one place that does not say "inform, never disable", because that case froze a Mac.
 */
export function MeasureListView({
  arms,
  history,
  running,
  models = {},
  ticked: firstTicked = [],
  saved: firstSaved = false,
  error,
  busy = false,
  now,
  onModel,
  onStart,
  onCheck,
  onOpen,
}: {
  arms: readonly EvalPlanArm[];
  history: readonly EvalSummary[];
  /** The id of the measurement that runs now, or null. */
  running: string | null;
  models?: Readonly<Record<string, string>>;
  /** The arms ticked at first, for the gallery and the tests. */
  ticked?: readonly string[];
  saved?: boolean;
  error: string | null;
  busy?: boolean;
  now?: Date;
  onModel?: (arm: string, model: string) => void;
  onStart: (arms: string[], allowTight: boolean) => void;
  onCheck: () => void;
  onOpen: (id: string) => void;
}) {
  const rows = armRows(arms);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set(firstTicked));
  const [saved, setSaved] = useState(firstSaved);
  // An arm that cannot be ticked now (memory changed since) is not counted, whatever was ticked before.
  const chosen = new Set([...ticked].filter((name) => rows.find((row) => row.name === name)?.canTick === true));
  const plan = startPlan(rows, chosen, saved, running !== null);
  const lines = measureList(history, now);
  const current = lines.find((row) => row.running);
  const blocked = noRoomLine(rows);
  const boxId = useId();
  const asks = rows[0]?.asks ?? 10;
  return (
    <div className="flex max-w-column flex-col gap-4">
      <section aria-labelledby={`${boxId}-new`} className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <h3 id={`${boxId}-new`} className="text-sm font-medium text-ink">
          New measurement
        </h3>
        <p className="text-sm text-muted">
          golem plays {asks} fixed asks twice, with helpers and without, and compares the answer, the time and the room left in the window. The result proposes the four numbers on the Rules tab. Nothing changes until you say so.
        </p>
        {current === undefined ? null : (
          <p className="rounded-md bg-wait-soft px-3 py-2 text-sm text-wait" role="status">
            <b className="font-medium">A measurement is running: {current.note}.</b> One runs at a time.{" "}
            <button type="button" className="underline outline-offset-2 outline-clay focus-visible:outline-2" onClick={() => onOpen(current.id)}>
              Open it
            </button>
          </p>
        )}
        {blocked === null ? null : (
          <p className="rounded-md bg-deny-soft px-3 py-2 text-sm text-deny" role="status">
            {blocked}
          </p>
        )}
        {rows.length === 0 ? <p className="text-sm text-muted">There is nothing to measure yet.</p> : null}
        <ul aria-label="Arms of the measurement" className="flex flex-col">
          {rows.map((row) => (
            <ArmItem
              key={row.name}
              row={row}
              checked={chosen.has(row.name)}
              model={models[row.name]}
              onModel={(model) => onModel?.(row.name, model)}
              onTick={(on) => {
                setTicked((before) => {
                  const next = new Set(before);
                  if (on) next.add(row.name);
                  else next.delete(row.name);
                  return next;
                });
              }}
            />
          ))}
        </ul>
        {error === null ? null : (
          <p role="alert" className="text-sm text-deny">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
          {rows.some((row) => row.needsSaved) ? (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="accent-clay" />
              <span>{SAVED_WORK_TEXT}</span>
            </label>
          ) : null}
          <Button size="sm" onClick={onCheck}>
            Check memory again
          </Button>
          <span className="flex-1 text-sm text-muted" data-measure-line="">
            {plan.line}
          </span>
          <Button kind="primary" disabled={!plan.canStart || busy} onClick={() => onStart(plan.arms, plan.allowTight)}>
            Start
          </Button>
        </div>
        <p className="text-meta text-muted">While it runs, chats on the local model wait. You can stop it at any time and keep what is done.</p>
      </section>
      <section aria-labelledby={`${boxId}-old`} className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3">
        <div>
          <h3 id={`${boxId}-old`} className="text-sm font-medium text-ink">
            Measurements
          </h3>
          <p className="text-meta text-muted">Kept on this Mac. Open one to see its table.</p>
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-muted">No measurements yet.</p>
        ) : (
          <ul aria-label="Measurements" className="flex flex-col">
            {lines.map((row) => (
              <HistoryRow key={row.id} row={row} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
