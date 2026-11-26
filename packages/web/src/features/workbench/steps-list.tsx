import { useId, useState, type ReactNode } from "react";
import { formatElapsed, type BarKind, type CardTone, type HelperRef, type StepRow, type StepsList } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { openHelper, type HelperOpen } from "../chat/helper-open.ts";

const TONE: Record<CardTone, string> = {
  run: "text-muted",
  ok: "text-allow",
  wait: "text-wait",
  bad: "text-deny",
};

/** A bar segment's look: working is the running colour, a line is hatched on the sunken track, waiting for you is the wait colour. */
const SEGMENT: Record<BarKind, string> = {
  work: "bg-clay",
  line: "bg-hatch",
  you: "bg-wait",
};

const KIND_WORDS: Record<BarKind, string> = {
  work: "worked",
  line: "waited in line",
  you: "waited for you",
};

const LEGEND: readonly (readonly [BarKind, string])[] = [
  ["work", "working"],
  ["line", "waiting in line"],
  ["you", "waiting for you"],
];

/** One `delegate` call, ready to draw: its one-line head, its list and the helper sessions its rows open. */
export type StepsBatch = { callId: string; head: string; list: StepsList; refs: readonly HelperRef[] };

/** `worked 40s, waited in line 12s`: the text alternative of a bar, from its segments on the list's scale. */
export function barText(row: StepRow, spanMs: number): string {
  const total: Record<BarKind, number> = { work: 0, line: 0, you: 0 };
  for (const segment of row.segments) total[segment.kind] += (segment.to - segment.from) * spanMs;
  const parts = (["work", "line", "you"] as const).filter((kind) => total[kind] >= 500).map((kind) => `${KIND_WORDS[kind]} ${formatElapsed(Math.round(total[kind]))}`);
  return parts.length === 0 ? "no time yet" : parts.join(", ");
}

function Bar({ row, spanMs }: { row: StepRow; spanMs: number }) {
  return (
    <span role="img" aria-label={barText(row, spanMs)} data-bar className="relative block h-2 w-full overflow-hidden rounded-sm bg-sunken">
      {row.segments.map((segment) => (
        <span
          key={`${segment.kind}:${String(segment.from)}`}
          data-segment={segment.kind}
          className={cn("absolute inset-y-0", SEGMENT[segment.kind])}
          style={{ left: `${segment.from * 100}%`, width: `${(segment.to - segment.from) * 100}%` }}
        />
      ))}
    </span>
  );
}

function Legend() {
  return (
    <p data-legend className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted">
      {LEGEND.map(([kind, word]) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("inline-block h-2 w-4 rounded-sm border border-line", SEGMENT[kind])} />
          {word}
        </span>
      ))}
    </p>
  );
}

/**
 * What a row adds to the list: `detail` is shown under its bar (cost, model, the one line of its output),
 * `open` is what a click on the row unfolds (the whole output, a way to its chat). A row with `open` is a button.
 */
export type StepExtra = { detail?: ReactNode; open?: ReactNode };

type RowProps = { row: StepRow; spanMs: number; callId: string; refs: readonly HelperRef[]; onOpen: (open: HelperOpen) => void; extra: StepExtra | undefined };

function Row({ row, spanMs, callId, refs, onOpen, extra }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const ref = row.role === "helper" ? refs.find((item) => `${callId}:${String(item.index)}` === row.id) : undefined;
  const unfolds = extra?.open !== undefined && extra.open !== null;
  const body = (
    <>
      <span className="flex min-w-0 items-baseline justify-between gap-x-3">
        <span className="truncate font-medium text-ink">{row.label}</span>
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          <span data-row-state className={TONE[row.tone]}>
            {row.right}
          </span>
          <span className="text-faint">{row.took}</span>
        </span>
      </span>
      <span className="mt-1 block">
        <Bar row={row} spanMs={spanMs} />
      </span>
      {extra?.detail === undefined || extra.detail === null ? null : (
        <span data-row-detail className="mt-1 block text-muted">
          {extra.detail}
        </span>
      )}
    </>
  );
  const press = "block w-full cursor-pointer px-3 py-1.5 text-left -outline-offset-2 outline-clay hover:bg-slip focus-visible:outline-2";
  return (
    <li data-step-row className="border-b border-line last:border-b-0">
      {unfolds ? (
        <>
          <button type="button" aria-expanded={expanded} aria-controls={panelId} className={press} onClick={() => setExpanded(!expanded)}>
            {body}
          </button>
          <div id={panelId} hidden={!expanded} data-row-open className="border-t border-line px-3 py-2">
            {expanded ? extra.open : null}
          </div>
        </>
      ) : ref === undefined ? (
        <div className="px-3 py-1.5">{body}</div>
      ) : (
        <button
          type="button"
          aria-label={`Open ${row.label}, ${row.right}`}
          className={press}
          onClick={() => {
            onOpen({ callId, helperId: ref.id });
          }}
        >
          {body}
        </button>
      )}
    </li>
  );
}

/**
 * The steps of `delegate` calls, newest first: a head line, then a row per step with a
 * time bar on the call's shared scale. A row is a button that opens its helper: in the panel beside the chat, or through `onOpen` where no chat is in view. Pure: the
 * lists come built, with "now" already in them. It takes data, not a session, and fills the width it is given: the
 * Steps tab (drawer width) and Runs in the rail (full width) draw it, and so does a workflow run, where `extra` adds each step's output.
 */
export function StepsView({
  batches,
  onOpen = openHelper,
  extra,
}: {
  batches: readonly StepsBatch[];
  onOpen?: (open: HelperOpen) => void;
  /** What a row adds: its detail line and what it unfolds. Not given for a chat's helpers. */
  extra?: (row: StepRow) => StepExtra | undefined;
}) {
  return (
    <div data-steps className="flex flex-col gap-5 text-meta leading-snug">
      <Legend />
      {batches.map(({ callId, head, list, refs }) => (
        <section key={callId} aria-label={`Steps, ${head}`} data-steps-batch className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink">{head}</h3>
          <ul className="m-0 flex list-none flex-col rounded-md border border-line bg-sunken p-0">
            {list.rows.map((row) => (
              <Row key={row.id} row={row} spanMs={list.spanMs} callId={callId} refs={refs} onOpen={onOpen} extra={extra?.(row)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
