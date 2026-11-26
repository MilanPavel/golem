import { useId, useMemo, useRef, useState } from "react";
import {
  chartPoints,
  columnAlign,
  cutCell,
  formatCell,
  modelSawText,
  nextOffset,
  pickChart,
  previousOffset,
  RESULT_DEFAULT_PAGE_SIZE,
  RESULT_PAGE_SIZES,
  resultHeader,
  ROWS_WITHHELD_LINE,
  rowRangeText,
  sortRows,
  SORTED_ON_PAGE,
  type ResultCell,
} from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Button } from "../../ui/button.tsx";
import { dataErrorText, type DataResult, type DataResultPageParams, type ToolTable } from "../../store/data.ts";
import { Code } from "../../ui/code.tsx";
import { ResultChart } from "./result-chart.tsx";

type Sort = { column: number; descending: boolean };
type Page = { offset: number; rows: readonly (readonly ResultCell[])[]; total: number };

function Cell({ value, type, open, onToggle }: { value: ResultCell; type: string; open: boolean; onToggle: () => void }) {
  const cell = formatCell(value);
  const align = columnAlign(type) === "right" ? "text-right" : "text-left";
  if (cell.kind === "null") {
    return <td className={cn("px-2 py-1 text-faint", align)}>{cell.text}</td>;
  }
  const cut = cell.kind === "text" ? cutCell(cell.text) : { text: cell.text, cut: false };
  return (
    <td className={cn("px-2 py-1 whitespace-nowrap text-muted", align, cell.kind === "number" && "tabular-nums")}>
      {cut.cut ? (
        <button type="button" aria-expanded={open} title={cell.text} onClick={onToggle} className="text-left outline-offset-2 outline-clay focus-visible:outline-2">
          <Code tone="inherit" className={open ? "wrap-anywhere whitespace-pre-wrap" : undefined}>
            {open ? cell.text : cut.text}
          </Code>
        </button>
      ) : (
        <Code tone="inherit">{cell.text}</Code>
      )}
    </td>
  );
}

/** The state a table can open in. For the gallery and tests; a person never sets it. */
export type ResultTableInitial = { page?: Page; size?: number; sort?: Sort; view?: "table" | "chart"; showStub?: boolean; error?: string };

/**
 * A kept query result: its columns with their types, a page of rows, paging through the daemon, a sort of
 * the loaded page, a chart when the column types allow one, and a line when the model got no rows.
 * `onPage` is missing where the page cannot ask the daemon.
 */
export function ResultTable({ table, rowsWithheld = false, onPage, initial }: { table: ToolTable; rowsWithheld?: boolean; onPage?: (params: DataResultPageParams) => Promise<DataResult>; initial?: ResultTableInitial }) {
  const ids = useId();
  const [size, setSize] = useState(initial?.size ?? RESULT_DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState<Page>(initial?.page ?? { offset: 0, rows: table.rows, total: table.total_rows });
  const [sort, setSort] = useState<Sort | null>(initial?.sort ?? null);
  const [view, setView] = useState<"table" | "chart">(initial?.view ?? "table");
  const [valueColumn, setValueColumn] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [showStub, setShowStub] = useState(initial?.showStub ?? false);
  const latest = useRef(0);

  const pick = useMemo(() => pickChart(table.columns), [table.columns]);
  const rows = useMemo(() => {
    const column = sort === null ? undefined : table.columns[sort.column];
    return sort === null || column === undefined ? page.rows : sortRows(page.rows, sort.column, column.type, sort.descending);
  }, [page.rows, sort, table.columns]);

  function go(offset: number, limit: number): void {
    if (onPage === undefined) return;
    const ticket = ++latest.current;
    setLoading(true);
    setError(null);
    onPage({ result_id: table.result_id, offset, limit }).then(
      (found) => {
        if (ticket !== latest.current) return;
        setLoading(false);
        setSize(limit);
        setExpanded(new Set());
        setPage({ offset, rows: found.rows, total: found.total_rows ?? table.total_rows });
      },
      (failed: unknown) => {
        if (ticket !== latest.current) return;
        setLoading(false);
        setError(dataErrorText(failed, "Could not read that page."));
      },
    );
  }

  const next = nextOffset(page.offset, size, page.total);
  const previous = previousOffset(page.offset, size);
  const chosenValue = pick === null ? null : pick.values.includes(valueColumn ?? -1) ? (valueColumn as number) : (pick.values[0] ?? null);
  const chart = pick !== null && chosenValue !== null ? chartPoints(rows, pick, chosenValue) : null;
  const columnName = (index: number | null): string => (index === null ? "" : (table.columns[index]?.name ?? ""));
  const incomplete = page.rows.length < page.total && onPage === undefined;

  return (
    <div data-result={table.result_id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Code tone="muted" className="text-meta">{resultHeader({ ...table })}</Code>
        {pick === null ? null : (
          <span role="group" aria-label="Show as" className="ml-auto flex overflow-hidden rounded-md border border-line-strong text-meta">
            {(["table", "chart"] as const).map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={view === each}
                onClick={() => setView(each)}
                className={cn("px-2 py-0.5 outline-offset-2 outline-clay focus-visible:outline-2", view === each ? "bg-clay text-on-clay" : "text-muted hover:text-ink")}
              >
                {each}
              </button>
            ))}
          </span>
        )}
      </div>

      {view === "chart" && chart !== null && pick !== null ? (
        <div className="flex flex-col gap-2">
          {pick.values.length > 1 ? (
            <label className="flex items-center gap-2 text-meta text-faint">
              Chart
              <select
                value={chosenValue ?? undefined}
                onChange={(event) => setValueColumn(Number(event.target.value))}
                className="rounded-md border border-line-strong bg-surface px-2 py-0.5 text-meta text-ink outline-offset-2 outline-clay focus-visible:outline-2"
              >
                {pick.values.map((index) => (
                  <option key={index} value={index}>
                    {columnName(index)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <ResultChart kind={pick.kind} points={chart.points} cut={chart.cut} label={columnName(pick.label)} value={columnName(chosenValue)} />
          {page.total > page.rows.length ? <p className="text-meta text-faint">The chart shows the rows of this page.</p> : null}
        </div>
      ) : (
        <div role="group" aria-label="Rows of the result" tabIndex={0} className="max-h-72 overflow-auto rounded-md border border-line outline-offset-2 outline-clay focus-visible:outline-2">
          <table className="w-full border-collapse text-code">
            <caption className="sr-only">Rows from @{table.source}</caption>
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line-strong">
                {table.columns.map((column, index) => (
                  <th
                    key={index}
                    scope="col"
                    aria-sort={sort?.column === index ? (sort.descending ? "descending" : "ascending") : "none"}
                    className={cn("px-2 py-1 font-normal", columnAlign(column.type) === "right" ? "text-right" : "text-left")}
                  >
                    <button
                      type="button"
                      onClick={() => setSort(sort?.column === index ? (sort.descending ? null : { column: index, descending: true }) : { column: index, descending: false })}
                      className="inline-flex items-baseline gap-1 text-ink outline-offset-2 outline-clay focus-visible:outline-2"
                    >
                      <span>{column.name}</span>
                      <span aria-hidden="true" className="text-faint">
                        {sort?.column === index ? (sort.descending ? "▼" : "▲") : ""}
                      </span>
                    </button>
                    <span className="block text-meta text-faint">{column.type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(table.columns.length, 1)} className="px-2 py-2 text-muted">
                    The query returned no rows.
                  </td>
                </tr>
              ) : (
                rows.map((row, at) => (
                  <tr key={at} className="border-b border-line">
                    {table.columns.map((column, index) => (
                      <Cell
                        key={index}
                        value={row[index] ?? null}
                        type={column.type}
                        open={expanded.has(`${at}:${index}`)}
                        onToggle={() => {
                          const key = `${at}:${index}`;
                          setExpanded((current) => {
                            const copy = new Set(current);
                            if (copy.has(key)) copy.delete(key);
                            else copy.add(key);
                            return copy;
                          });
                        }}
                      />
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-faint">
        <span role="status">
          {loading ? "Loading…" : rowRangeText(page.offset, page.rows.length, page.total)}
          {sort !== null && view === "table" ? ` · ${SORTED_ON_PAGE}` : ""}
        </span>
        {onPage === undefined ? null : (
          <>
            {previous === null ? null : (
              <Button size="sm" onClick={() => go(previous, size)}>
                Previous
              </Button>
            )}
            {next === null ? null : (
              <Button size="sm" onClick={() => go(next, size)}>
                Next
              </Button>
            )}
            {page.total > RESULT_DEFAULT_PAGE_SIZE || size !== RESULT_DEFAULT_PAGE_SIZE ? (
              <label className="flex items-center gap-1">
                Rows per page
                <select
                  id={`${ids}-size`}
                  value={size}
                  onChange={(event) => go(0, Number(event.target.value))}
                  className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-meta text-ink outline-offset-2 outline-clay focus-visible:outline-2"
                >
                  {RESULT_PAGE_SIZES.map((each) => (
                    <option key={each} value={each}>
                      {each}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        )}
        {incomplete ? <span>Only the first rows are loaded here.</span> : null}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny wrap-anywhere">
          {error}
        </p>
      )}

      {rowsWithheld ? (
        <div data-withheld className="flex flex-col gap-1 rounded-md border border-line bg-wait-soft px-2.5 py-1.5 text-meta">
          <p className="flex flex-wrap items-center gap-2 text-muted">
            <span>{ROWS_WITHHELD_LINE}</span>
            <button type="button" aria-expanded={showStub} onClick={() => setShowStub((on) => !on)} className="text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2">
              {showStub ? "Hide" : "Show what it saw"}
            </button>
          </p>
          {showStub ? <pre className="whitespace-pre-wrap text-muted">
              <Code tone="inherit">{modelSawText({ ...table })}</Code>
            </pre> : null}
        </div>
      ) : null}
    </div>
  );
}
