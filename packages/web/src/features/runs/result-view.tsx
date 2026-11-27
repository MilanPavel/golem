import { EMPTY_RESULT_WORDS, resultKind, stepOutputText, workerResult } from "@golem/view";
import { useState } from "react";
import { Code } from "../../ui/code.tsx";
import { cn } from "../../ui/cn.ts";
import { Markdown } from "../chat/markdown-view.tsx";

const LINK = "text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2";
const PRE = "m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-code text-ink";

/** The most rows of a table shown at once; the rest are counted. */
export const RESULT_ROW_CAP = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value in a cell or beside a label: text and numbers as they are, anything nested as one line of JSON. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** What a worker step changed: its copy, its files and its checks. */
export function WorkerBlock({ result }: { result: unknown }) {
  const worker = workerResult(result);
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

function RecordList({ record }: { record: Record<string, unknown> }) {
  return (
    <dl className="m-0 grid cols-label-value gap-x-3 gap-y-0.5 text-meta">
      {Object.entries(record).map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-faint">{key}</dt>
          <dd className="m-0 min-w-0 break-words">{typeof value === "object" && value !== null ? <Code>{cellText(value)}</Code> : cellText(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ rows }: { rows: readonly Record<string, unknown>[] }) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const shown = rows.slice(0, RESULT_ROW_CAP);
  return (
    <div className="flex flex-col gap-1">
      <div className="max-h-72 overflow-auto">
        <table className="w-full border-collapse text-left text-meta">
          <caption className="sr-only">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </caption>
          <thead>
            <tr className="text-faint">
              {columns.map((column) => (
                <th key={column} scope="col" className="py-1 pr-3 font-normal">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={index} className="border-t border-line align-top">
                {columns.map((column) => (
                  <td key={column} className="max-w-xs py-1 pr-3 break-words">
                    {cellText(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length ? <p className="m-0 text-meta text-faint">{rows.length - shown.length} more</p> : null}
    </div>
  );
}

function Readable({ result }: { result: unknown }) {
  switch (resultKind(result)) {
    case "empty":
      return <p className="m-0 text-meta text-muted">{EMPTY_RESULT_WORDS}</p>;
    case "text":
      return (
        <div className="max-h-72 overflow-auto">
          <Markdown text={result as string} />
        </div>
      );
    case "file":
      return (
        <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-2.5 py-1.5 text-meta">
          <span className="text-faint">File</span>
          <Code className="min-w-0 break-all">{(result as string).trim()}</Code>
        </div>
      );
    case "link": {
      const href = (result as string).trim();
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className={cn(LINK, "text-meta break-all")}>
          {href}
        </a>
      );
    }
    case "record":
      return <RecordList record={result as Record<string, unknown>} />;
    case "table":
      return <Table rows={(result as unknown[]).filter(isRecord)} />;
    case "changes":
      return <WorkerBlock result={result} />;
    case "other":
      return <pre className={PRE}>{stepOutputText(result)}</pre>;
  }
}

/**
 * A step's saved result drawn by its shape (`resultKind`): text as Markdown, a record as labels and values, a
 * list of records as a table, a path as a file card, a URL as a link, a worker's work as its changes. "Raw"
 * shows the JSON as the daemon saved it. Nothing for a step with no result.
 */
export function ResultView({ result, label }: { result: unknown; label: string }) {
  const [raw, setRaw] = useState(false);
  if (result === null || result === undefined) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <ReadableRawSwitch raw={raw} onChange={setRaw} />
      {raw ? <pre className={PRE}>{stepOutputText(result)}</pre> : <Readable result={result} />}
    </div>
  );
}

/** The Readable / Raw switch above a result. */
export function ReadableRawSwitch({ raw, onChange }: { raw: boolean; onChange: (raw: boolean) => void }) {
  const choice = (on: boolean) => cn("rounded px-2 py-0.5 text-meta outline-offset-2 outline-clay focus-visible:outline-2", raw === on ? "bg-surface text-ink" : "text-muted hover:text-ink");
  return (
    <div role="group" aria-label="Show the result as" className="flex w-fit gap-1 rounded-md border border-line p-0.5">
      <button type="button" aria-pressed={!raw} className={choice(false)} onClick={() => onChange(false)}>
        Readable
      </button>
      <button type="button" aria-pressed={raw} className={choice(true)} onClick={() => onChange(true)}>
        Raw
      </button>
    </div>
  );
}

/** The look of a block of raw text. */
export const RAW_TEXT = PRE;
