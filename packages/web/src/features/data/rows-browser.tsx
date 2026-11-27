import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  askViewText,
  cellText,
  fileName,
  filterText,
  isNumberType,
  keptPages,
  nextSort,
  PAGE_ROWS,
  pagesFor,
  ROW_HEIGHT,
  ROWS_NOT_AVAILABLE,
  rowsFootnote,
  rowsStatus,
  rowWindow,
  scrollForRow,
  SEARCH_HINT,
  typeText,
  viewSql,
  type ViewCell,
  type ViewFilter,
  type ViewSort,
} from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Input } from "../../ui/input.tsx";
import { dataErrorText, isDataMissing, type DataBrowseResult, type DataBrowseView } from "../../store/data.ts";

/** What narrows and orders the rows of a table: the filters, the search and the sort. It lives above the browser, so it survives a visit to another tab. */
export interface RowsView {
  filters: ViewFilter[];
  search: string;
  sort: ViewSort | null;
}

export const EMPTY_VIEW: RowsView = { filters: [], search: "", sort: null };

/** How tall the grid is when the browser cannot say, such as in a test. */
const FALLBACK_VIEWPORT = 480;
/** How long the search waits for the next key before it asks. */
const SEARCH_WAIT_MS = 300;

type Loaded = { key: string; pages: Record<number, ViewCell[][]>; total: number | null; failure: string | null };
const NOTHING: Loaded = { key: "", pages: {}, total: null, failure: null };

function viewKey(table: string, view: RowsView): string {
  return JSON.stringify([table, view.filters, view.search, view.sort]);
}

/** The view as what `data.browse` takes. It holds names and values, never SQL. */
function browseView(view: RowsView, offset: number): DataBrowseView {
  return {
    offset,
    limit: PAGE_ROWS,
    ...(view.sort === null ? {} : { sort: view.sort }),
    filters: view.filters.map((filter) => (filter.op === "is null" ? { column: filter.column, op: "is null" as const } : { column: filter.column, op: "=" as const, value: filter.value ?? null })),
    ...(view.search === "" ? {} : { search: view.search }),
  };
}

function Skeleton({ at, column }: { at: number; column: number }) {
  return <span aria-hidden="true" className="inline-block h-2.5 rounded-sm bg-line" style={{ width: `${3 + ((at * 7 + column * 3) % 6)}rem` }} />;
}

function Detail({ columns, row, number, onClose }: { columns: readonly { name: string; type: string }[]; row: ViewCell[] | null; number: number; onClose: () => void }) {
  return (
    <aside aria-label={`Row ${number}`} className="h-120 w-80 shrink-0 overflow-y-auto rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center">
        <h3 className="text-sm font-medium">Row {number.toLocaleString("en-US").replace(/,/g, " ")}</h3>
        <Button kind="ghost" size="sm" className="ml-auto" aria-label="Close row" onClick={onClose}>
          ✕
        </Button>
      </div>
      {row === null ? (
        <p className="text-sm text-muted">Reading the row.</p>
      ) : (
        <dl className="grid gap-x-3 gap-y-1.5 text-meta" style={{ gridTemplateColumns: "6.5rem 1fr" }}>
          {columns.map((column, at) => (
            <div key={column.name} className="contents">
              <dt className="break-words">
                <Code tone="inherit" className="text-faint">
                  {column.name}
                </Code>
              </dt>
              <dd className="break-words">
                <Code tone="inherit" className={cn("whitespace-pre-wrap break-words", row[at] === null && "text-faint")}>
                  {cellText(row[at] ?? null)}
                </Code>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}

export interface RowsBrowserProps {
  source: string;
  table: string;
  /** The columns to show, in order. The daemon sends them all; the ones not named here are left out. */
  columns: readonly { name: string; type: string }[];
  /** How many rows the whole table has, for "filtered from". */
  tableRows: number | null;
  view: RowsView;
  onView: (view: RowsView) => void;
  /** One page of the table, from `data.browse`. */
  onBrowse: (table: string, view: DataBrowseView) => Promise<DataBrowseResult>;
  /** Opens a new chat with this text in the composer. */
  onAskView: (text: string) => void;
  /** A state to start in, for the gallery and the tests: pages already read, and a row already open. */
  initial?: RowsBrowserInitial;
}

export interface RowsBrowserInitial {
  /** Pages already read, by page number, with the columns in the order of `columns`. */
  pages?: Record<number, ViewCell[][]>;
  total?: number;
  selected?: number;
  open?: boolean;
}

/**
 * The Rows tab: every row of a table in a grid that loads pages as it scrolls. The scrollbar has the height of all
 * the rows, a sort or a filter works across the whole table, and a click on a row reads it in full. The browser
 * asks for pages by name and value; it sends no SQL.
 */
export function RowsBrowser({ source, table, columns, tableRows, view, onView, onBrowse, onAskView, initial }: RowsBrowserProps) {
  const searchId = useId();
  const key = viewKey(table, view);
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);
  const [loaded, setLoaded] = useState<Loaded>(() => (initial?.pages === undefined ? NOTHING : { key, pages: initial.pages, total: initial.total ?? null, failure: null }));
  const asked = useRef(new Set<string>());
  const wrap = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [selected, setSelected] = useState<number | null>(initial?.selected ?? null);
  const [open, setOpen] = useState(initial?.open ?? false);
  const [text, setText] = useState(view.search);

  const names = columns.map((column) => column.name).join("\u0000");
  const fresh = loaded.key === key;
  const pages = fresh ? loaded.pages : NOTHING.pages;
  const total = fresh ? loaded.total : null;
  const failure = fresh ? loaded.failure : null;
  const height = viewport > 0 ? viewport : FALLBACK_VIEWPORT;
  const frame = rowWindow(scrollTop, height, total ?? 0);
  const textColumns = useMemo(() => columns.filter((column) => /^(VARCHAR|TEXT|STRING)/i.test(column.type)).map((column) => column.name), [columns]);

  // A new view starts at the top.
  const shownKey = useRef(key);
  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    wrap.current?.scrollTo?.({ top: 0 });
    setScrollTop(0);
    setSelected(null);
    setOpen(false);
    asked.current = new Set();
  }, [key]);

  // The grid's height, so a tall window shows more rows.
  useEffect(() => {
    const node = wrap.current;
    if (node === null) return;
    const measure = (): void => setViewport(node.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(measure);
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);

  // The search waits until the typing stops.
  useEffect(() => {
    const next = text.trim();
    if (next === view.search) return;
    const timer = setTimeout(() => onView({ ...view, search: next }), SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask for the pages the window touches.
  const want = total === null ? [0] : pagesFor(frame.first, frame.count);
  const wantKey = want.join(",");
  useEffect(() => {
    for (const page of want) {
      const id = `${key}#${page}`;
      if (pages[page] !== undefined || asked.current.has(id)) continue;
      asked.current.add(id);
      onBrowse(table, browseView(view, page * PAGE_ROWS)).then(
        (answer) => {
          if (keyRef.current !== key) return;
          const at = columns.map((column) => answer.columns.findIndex((each) => each.name === column.name));
          const rows = answer.rows.map((row) => at.map((index) => (index < 0 ? null : (row[index] ?? null))));
          setLoaded((now) => {
            const base = now.key === key ? now : { ...NOTHING, key };
            const next = { ...base.pages, [page]: rows };
            const middle = frame.seen.first;
            const keep = new Set(keptPages(Object.keys(next).map(Number), middle));
            const kept: Record<number, ViewCell[][]> = {};
            for (const [number, each] of Object.entries(next)) if (keep.has(Number(number))) kept[Number(number)] = each;
            return { ...base, pages: kept, total: answer.total_rows ?? base.total, failure: null };
          });
        },
        (error: unknown) => {
          asked.current.delete(id);
          if (keyRef.current !== key) return;
          setLoaded((now) => ({ ...(now.key === key ? now : { ...NOTHING, key }), failure: isDataMissing(error) ? ROWS_NOT_AVAILABLE : dataErrorText(error, "Could not read the rows.") }));
        },
      );
    }
  }, [key, wantKey, names, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  function rowAt(index: number): ViewCell[] | null {
    return pages[Math.floor(index / PAGE_ROWS)]?.[index % PAGE_ROWS] ?? null;
  }

  function show(index: number): void {
    const node = wrap.current;
    if (node === null || total === null) return;
    const seen = rowWindow(node.scrollTop, height, total).seen;
    const onScreen = Math.max(1, Math.floor((height - ROW_HEIGHT) / ROW_HEIGHT));
    if (index < seen.first) node.scrollTop = scrollForRow(index, height, total);
    else if (index > seen.first + onScreen - 1) node.scrollTop = scrollForRow(index - onScreen + 1, height, total);
  }

  function move(to: number): void {
    if (total === null || total === 0) return;
    const index = Math.max(0, Math.min(total - 1, to));
    setSelected(index);
    show(index);
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target instanceof HTMLInputElement) return;
    const onGrid = event.target === wrap.current;
    if (!onGrid && event.key !== "Escape") return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const from = selected ?? frame.seen.first - (event.key === "ArrowDown" ? 1 : -1);
      move(from + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && selected !== null) {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const shownColumns = columns;
  const first = frame.first;
  const last = Math.min(total ?? 0, first + frame.count);
  const rowIndexes = total === null ? Array.from({ length: Math.ceil(height / ROW_HEIGHT) }, (_, at) => at) : Array.from({ length: last - first }, (_, at) => first + at);
  const bottom = total === null ? 0 : Math.max(0, frame.track - frame.top - (last - first) * ROW_HEIGHT);
  const pageCount = Object.keys(pages).length;

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKey}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={searchId}>
          Find in text columns
        </label>
        <Input id={searchId} type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder={SEARCH_HINT} className="w-64 py-1 text-meta" />
        <span className="flex flex-wrap gap-1">
          {view.filters.map((filter) => (
            <span key={filter.column} className="inline-flex items-center gap-1 rounded-full bg-clay-soft px-2 py-0.5 text-xs text-clay-ink">
              {filterText(filter)}
              <button type="button" aria-label={`Remove filter ${filterText(filter)}`} onClick={() => onView({ ...view, filters: view.filters.filter((each) => each.column !== filter.column) })} className="rounded-full px-0.5 outline-offset-2 outline-clay focus-visible:outline-2">
                ✕
              </button>
            </span>
          ))}
        </span>
        <span role="status" className="ml-auto text-meta text-faint">
          {failure === null ? rowsStatus(frame.seen.first + 1, frame.seen.last + 1, total, tableRows) : ""}
        </span>
        <Button size="sm" onClick={() => wrap.current?.scrollTo?.({ top: 0 })}>
          ↑ First
        </Button>
        <Button size="sm" onClick={() => onAskView(askViewText(source, viewSql(table, view, textColumns)))}>
          Ask about this view
        </Button>
      </div>
      <div className="flex gap-3">
        <div
          ref={wrap}
          tabIndex={0}
          role="group"
          aria-label={`Rows of ${table}, scrollable`}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="relative h-120 min-w-0 flex-1 overflow-auto rounded-lg border border-line bg-surface outline-offset-2 outline-clay focus-visible:outline-2"
        >
          {failure !== null ? (
            <p role="alert" className="p-3 text-sm text-deny">
              {failure}
            </p>
          ) : (
            <table aria-rowcount={total ?? -1} className="min-w-full border-separate border-spacing-0 text-code">
              <caption className="sr-only">Rows of {table}</caption>
              <thead>
                <tr>
                  {shownColumns.map((column, at) => {
                    const sorted = view.sort?.column === column.name ? (view.sort.desc ? "descending" : "ascending") : "none";
                    return (
                      <th
                        key={column.name}
                        scope="col"
                        aria-sort={sorted}
                        className={cn("sticky -top-px border-b border-line-strong bg-sunken px-2.5 pb-1.5 pt-2 align-bottom font-normal text-muted", at === 0 ? "left-0 z-20" : "z-10", isNumberType(column.type) ? "text-right" : "text-left")}
                      >
                        <button type="button" onClick={() => onView({ ...view, sort: nextSort(view.sort, column.name) })} className="block w-full select-none text-inherit outline-offset-2 outline-clay focus-visible:outline-2" style={{ textAlign: "inherit" }}>
                          <Code tone="inherit" className="block text-ink">
                            {column.name}
                            {sorted === "none" ? "" : sorted === "ascending" ? " ↑" : " ↓"}
                          </Code>
                          <Code tone="inherit" className="block text-xs text-faint">
                            {typeText(column.type)}
                          </Code>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {total === 0 ? (
                  <tr>
                    <td colSpan={Math.max(1, shownColumns.length)} className="p-3 text-sm text-muted">
                      No rows match.
                    </td>
                  </tr>
                ) : (
                  <>
                    <tr aria-hidden="true">
                      <td colSpan={Math.max(1, shownColumns.length)} style={{ height: total === null ? 0 : frame.top, padding: 0, border: 0 }} />
                    </tr>
                    {rowIndexes.map((index) => {
                      const row = rowAt(index);
                      const on = selected === index;
                      return (
                        <tr key={index} aria-rowindex={index + 1} aria-selected={on} onClick={() => (setSelected(index), setOpen(true))} className="group cursor-pointer">
                          {shownColumns.map((column, at) => {
                            const value = row?.[at] ?? null;
                            const isFile = column.name === "file" && typeof value === "string";
                            const shownText = isFile ? fileName(value) : cellText(value);
                            return (
                              <td
                                key={column.name}
                                title={typeof value === "string" && (isFile || value.length > 24) ? value : undefined}
                                className={cn(
                                  "h-8 max-w-64 truncate whitespace-nowrap border-b border-line px-2.5",
                                  on ? "bg-clay-soft" : at === 0 ? "bg-surface group-hover:bg-bg" : "group-hover:bg-bg",
                                  at === 0 && "sticky left-0 z-5",
                                  isNumberType(column.type) && "text-right",
                                )}
                              >
                                {row === null ? <Skeleton at={index} column={at} /> : <Code tone="inherit" className={cn(value === null ? "text-faint" : "text-ink-soft")}>{shownText}</Code>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr aria-hidden="true">
                      <td colSpan={Math.max(1, shownColumns.length)} style={{ height: bottom, padding: 0, border: 0 }} />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
        {open && selected !== null ? <Detail columns={columns} row={rowAt(selected)} number={selected + 1} onClose={() => setOpen(false)} /> : null}
      </div>
      <p className="text-xs text-faint">{rowsFootnote(view.sort, total, pageCount)}</p>
    </div>
  );
}
