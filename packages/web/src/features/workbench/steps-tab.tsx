import { batchCard, batchSteps, formatElapsed, isDelegate, type BarKind, type CardTone, type ChatState, type HelperRef, type StepRow, type StepsList } from "@golem/view";
import { useSession } from "../../store/page-context.tsx";
import { cn } from "../../ui/cn.ts";
import { openHelper } from "../chat/helper-open.ts";
import { useNow } from "../sessions/use-now.ts";

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
    <p data-legend className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted">
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
 * The steps of the session's `delegate` calls, newest first: a head line, then a row per step with a
 * time bar on the call's shared scale. A row is a button that opens its helper in the panel. Pure: the
 * lists come built, with "now" already in them.
 */
export function StepsView({ batches }: { batches: readonly StepsBatch[] }) {
  return (
    <div data-steps className="flex flex-col gap-5 font-mono text-xs leading-snug">
      <Legend />
      {batches.map(({ callId, head, list, refs }) => (
        <section key={callId} aria-label={`Steps, ${head}`} data-steps-batch className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink">{head}</h3>
          <ul className="m-0 flex list-none flex-col rounded-md border border-line bg-sunken p-0">
            {list.rows.map((row) => {
              const ref = row.role === "helper" ? refs.find((item) => `${callId}:${String(item.index)}` === row.id) : undefined;
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
                    <Bar row={row} spanMs={list.spanMs} />
                  </span>
                </>
              );
              return (
                <li key={row.id} data-step-row className="border-b border-line last:border-b-0">
                  {ref === undefined ? (
                    <div className="px-3 py-1.5">{body}</div>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Open ${row.label}, ${row.right}`}
                      className="block w-full cursor-pointer px-3 py-1.5 text-left -outline-offset-2 outline-clay hover:bg-slip focus-visible:outline-2"
                      onClick={() => {
                        openHelper({ callId, helperId: ref.id });
                      }}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The helper sessions of each `delegate` call, by the id of the call. */
function refsByCall(chat: Pick<ChatState, "messages">): Map<string, readonly HelperRef[]> {
  const out = new Map<string, readonly HelperRef[]>();
  for (const message of chat.messages) {
    for (const tool of message.tools ?? []) {
      if (isDelegate(tool)) out.set(tool.callId, tool.child?.helpers ?? []);
    }
  }
  return out;
}

/** The batches of a reduced chat, newest first, as lists at `nowMs`. No clock here. */
export function stepsBatches(chat: Pick<ChatState, "messages" | "batches" | "batchTimes">, nowMs: number): StepsBatch[] {
  const refs = refsByCall(chat);
  return Object.values(chat.batches)
    .map((batch) => ({
      callId: batch.callId,
      head: batchCard(batch, "normal").head,
      list: batchSteps(batch, chat.batchTimes[batch.callId] ?? {}, nowMs),
      refs: refs.get(batch.callId) ?? [],
    }))
    .reverse();
}

/** Whether the chat has a batch to show: the Steps tab is there only then. */
export function hasSteps(chat: Pick<ChatState, "batches">): boolean {
  return Object.keys(chat.batches).length > 0;
}

/** The Steps tab: the session's batches of helpers, each a list with a time bar per row, moving once a second. */
export function StepsTab({ sessionId }: { sessionId: string }) {
  const chat = useSession(sessionId, (view) => view.chat);
  const now = useNow(1000);
  return <StepsView batches={stepsBatches(chat, now)} />;
}
