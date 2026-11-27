import { groupWords, repeatCount, shortTime, stepOutputLine, stepRowState, stepTook, stepWords, type RunStepRow } from "@golem/view";
import { useState } from "react";
import type { WorkflowStepInfo } from "../../store/workflows.ts";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";

/** The key of the Result (or Live) row, which is not a step. */
export const RESULT_KEY = "result";

const ROW = "flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-offset-2 outline-clay focus-visible:outline-2 hover:bg-surface";

const MARKS: Record<string, { glyph: string; look: string }> = {
  done: { glyph: "✓", look: "bg-allow-soft text-allow" },
  failed: { glyph: "✕", look: "bg-deny-soft text-deny" },
  in_doubt: { glyph: "!", look: "bg-wait-soft text-wait" },
  waiting: { glyph: "!", look: "bg-wait-soft text-wait" },
  running: { glyph: "", look: "bg-clay-soft text-clay-ink animate-pulse" },
  skipped: { glyph: "–", look: "border border-line text-faint" },
  pending: { glyph: "", look: "border border-line text-faint" },
};

/** The round mark of a state. It is decoration: the state is in the row's words too. */
export function StateMark({ state, star = false }: { state: string; star?: boolean }) {
  const mark = star ? { glyph: "★", look: MARKS[state]?.look ?? MARKS["pending"]!.look } : (MARKS[state] ?? MARKS["pending"]!);
  return (
    <span aria-hidden="true" className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-meta", mark.look)}>
      {mark.glyph}
    </span>
  );
}

/** One thing in the list: a mark, a title (and its item), one line, and the time. */
function Row({ selected, state, title, item, line, time, tone, onClick, expanded }: { selected: boolean; state: string; title: string; item?: string | null; line: string; time: string; tone?: "bad"; onClick: () => void; expanded?: boolean }) {
  return (
    <button type="button" aria-pressed={expanded === undefined ? selected : undefined} aria-expanded={expanded} aria-label={`${title}${item ? ` · ${item}` : ""}, ${stepWords(state)}`} className={cn(ROW, selected && "bg-surface")} onClick={onClick}>
      <StateMark state={state} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{title}</span>
          {item ? <Code tone="muted" className="min-w-0 truncate">{item}</Code> : null}
          <span className="ml-auto shrink-0 text-meta text-faint">{time}</span>
        </span>
        <span className={cn("truncate text-meta", tone === "bad" ? "text-deny" : "text-muted")}>{line}</span>
      </span>
    </button>
  );
}

/** What a step says in its row: why it failed, the line of its result, or what it is doing. */
function stepLine(step: WorkflowStepInfo): string {
  if (step.status === "failed" && step.error !== null && step.error !== undefined) return step.error;
  const output = stepOutputLine(step);
  if (output !== "") return output;
  if (step.status === "running") return "working…";
  if (step.status === "waiting") return "waits for you";
  return step.status === "pending" ? "not started" : stepWords(step.status);
}

/** How many squares for items that have not started a repeating row draws. */
const MAX_AHEAD = 120;

const SQUARE: Record<string, string> = { done: "bg-allow", skipped: "bg-faint", failed: "bg-deny", in_doubt: "bg-wait", running: "bg-clay animate-pulse", waiting: "bg-wait" };

/** The folded row: the title, a square for each item, a count, and the items that work or failed (all of them on request). */
function RepeatRow({ row, now, selected, onSelect }: { row: Extract<RunStepRow<WorkflowStepInfo>, { kind: "repeat" }>; now: number; selected: string; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const interesting = row.items.filter((item) => item.status === "running" || item.status === "waiting" || item.status === "failed" || item.status === "in_doubt");
  const shown = all ? row.items : interesting;
  const state = stepRowState(row);
  const count = repeatCount(row);
  // The ones still to come are shown as empty squares, up to a screenful: a total is only drawn when the workflow said it.
  const ahead = row.total === null ? 0 : Math.min(MAX_AHEAD, Math.max(0, row.total - row.items.length));
  const took = row.items.reduce((sum, item) => sum + (item.started_at ? Math.max(0, (Date.parse(item.finished_at ?? "") || now) - Date.parse(item.started_at)) : 0), 0);
  return (
    <div className="flex flex-col" data-fold={row.title}>
      <button type="button" aria-expanded={open} aria-label={`${row.title}, ${count}, ${stepWords(state)}`} className={ROW} onClick={() => setOpen((now) => !now)}>
        <StateMark state={state} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{row.title}</span>
            <span className="text-meta text-muted">{count}</span>
            <span className="ml-auto shrink-0 text-meta text-faint">{took > 0 ? shortTime(took) : ""}</span>
          </span>
          <span aria-hidden="true" className="flex flex-wrap gap-0.5">
            {row.items.map((item) => (
              <span key={item.key} className={cn("size-2 rounded-sm", SQUARE[item.status] ?? "border border-line")} />
            ))}
            {Array.from({ length: ahead }, (_, at) => (
              <span key={`ahead-${at}`} className="size-2 rounded-sm border border-line" />
            ))}
          </span>
        </span>
      </button>
      {open ? (
        <div className="ml-7 flex flex-col">
          {shown.length === 0 ? <p className="m-0 px-2.5 py-1 text-meta text-muted">None is working or failed.</p> : null}
          <ul className="m-0 flex list-none flex-col p-0">
            {shown.map((item) => (
              <li key={item.key} data-step-row={item.key}>
                <Row selected={selected === item.key} state={item.status} title={item.title} item={item.item} line={stepLine(item)} time={stepTook(item, now)} tone={item.status === "failed" ? "bad" : undefined} onClick={() => onSelect(item.key)} />
              </li>
            ))}
          </ul>
          {all || shown.length === row.items.length ? null : (
            <button type="button" className="w-fit px-2.5 py-1 text-meta text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2" onClick={() => setAll(true)}>
              Show all {row.items.length}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export type RunStepsProps = {
  rows: readonly RunStepRow<WorkflowStepInfo>[];
  now: number;
  /** `RESULT_KEY` or a step's key. */
  selected: string;
  onSelect: (key: string) => void;
  /** "Result" for a run that is over, "Live" for one that goes on. */
  resultWord: string;
  resultLine: string;
};

/** The vertical list: the Result row, then the steps top to bottom, each on a line. A loop is one row. */
export function RunSteps({ rows, now, selected, onSelect, resultWord, resultLine }: RunStepsProps) {
  // A caption stands over the first row of each run of rows in one group.
  const captions = rows.map((row, at) => {
    const group = groupWords(row.kind === "step" ? row.step : row.items[0]!);
    const before = at === 0 ? null : groupWords(rows[at - 1]!.kind === "step" ? (rows[at - 1] as Extract<RunStepRow<WorkflowStepInfo>, { kind: "step" }>).step : (rows[at - 1] as Extract<RunStepRow<WorkflowStepInfo>, { kind: "repeat" }>).items[0]!);
    return group !== null && group !== before ? group : null;
  });
  return (
    <ul aria-label="Steps of the run" className="m-0 flex list-none flex-col gap-0.5 p-0">
      <li>
        <button type="button" aria-pressed={selected === RESULT_KEY} className={cn(ROW, selected === RESULT_KEY && "bg-surface")} onClick={() => onSelect(RESULT_KEY)}>
          <StateMark state="done" star />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{resultWord}</span>
            <span className="truncate text-meta text-muted">{resultLine}</span>
          </span>
        </button>
      </li>
      {rows.map((row, at) => {
        const caption = captions[at] ?? null;
        return (
          <li key={row.kind === "step" ? row.step.key : `repeat:${row.title}`} className="flex flex-col" data-step-row={row.kind === "step" ? row.step.key : row.title}>
            {caption === null ? null : <span className="px-2.5 pt-1.5 text-meta text-faint">{caption}</span>}
            {row.kind === "step" ? (
              <Row selected={selected === row.step.key} state={row.step.status} title={row.step.title} item={row.step.item} line={stepLine(row.step)} time={stepTook(row.step, now)} tone={row.step.status === "failed" ? "bad" : undefined} onClick={() => onSelect(row.step.key)} />
            ) : (
              <RepeatRow row={row} now={now} selected={selected} onSelect={onSelect} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
