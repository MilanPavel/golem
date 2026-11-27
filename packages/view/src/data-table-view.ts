/**
 * The words and the arithmetic of a table's profile and its row browser: what a column's chart says, how a
 * view of the rows reads as SQL, and which rows a scroll position shows. Pure, so the web and the tests agree.
 */

export type Cell = string | number | boolean | null;

/** One test on a column, as `data.browse` takes it. */
export interface ViewFilter {
  column: string;
  op: "=" | "is null";
  value?: Cell;
}

/** A column to sort a view by. */
export interface ViewSort {
  column: string;
  desc: boolean;
}

/** How many rows one page holds. */
export const PAGE_ROWS = 200;
/** How many pages stay in memory: about 600 rows. */
export const KEPT_PAGES = 3;
/** The height of a row in pixels. */
export const ROW_HEIGHT = 32;
/** The tallest a scrollbar track is made, in pixels. A table taller than this scrolls by ratio, so dragging still reaches every row. */
export const MAX_SCROLL_HEIGHT = 8_000_000;
/** The most rows ask the daemon for at once. */
export const BROWSE_LIMIT = 500;

/** The words for what a click on a header does next: ascending, then descending, then not sorted. */
export function nextSort(sort: ViewSort | null, column: string): ViewSort | null {
  if (sort === null || sort.column !== column) return { column, desc: false };
  return sort.desc ? null : { column, desc: true };
}

/** A column's type as a person reads it, such as `bigint`. */
export function typeText(type: string): string {
  return type.toLowerCase();
}

/** Whether cells of this DuckDB type are numbers, which line up on the right. */
export function isNumberType(type: string): boolean {
  return /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|FLOAT|DOUBLE|REAL|DECIMAL.*)$/i.test(type.trim());
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** A number as a person reads it: whole numbers in groups of three, others to two decimals. `18302.5` is `18 302.5`. */
export function numberText(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return value < 0 ? `-${group(String(-value))}` : group(String(value));
  const fixed = Math.abs(value).toFixed(decimals).replace(/\.?0+$/, "");
  const [whole = "0", rest] = fixed.split(".");
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return `${sign}${group(whole)}${rest === undefined ? "" : `.${rest}`}`;
}

/** A cell for a grid: a number grouped, a missing value as a dash, anything else as it is. */
export function cellText(value: Cell): string {
  if (value === null) return "—";
  return typeof value === "number" ? numberText(value) : String(value);
}

/** A date or time from the daemon, without a midnight that carries no information. */
export function dateText(value: string): string {
  return value.replace(/T00:00:00(\.0+)?$/, "").replace("T", " ");
}

/** The edge of a range for a chart label: a number or a date. */
export function edgeText(value: Cell | undefined, isDate: boolean): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return numberText(value);
  return isDate ? dateText(String(value)) : String(value);
}

/** The two edges of a range for a chart's labels. A range of dates shows days, or times when it stays within one day. */
export function edgeLabels(min: Cell | undefined, max: Cell | undefined, isDate: boolean): [string, string] {
  if (!isDate || typeof min !== "string" || typeof max !== "string") return [edgeText(min, isDate), edgeText(max, isDate)];
  const sameDay = min.slice(0, 10) === max.slice(0, 10);
  const shown = (value: string): string => (sameDay ? dateText(value) : value.slice(0, 10));
  return [shown(min), shown(max)];
}

/** The label of a value in a category chart: the value, with a word when it is obvious what it means. */
export function categoryLabel(values: readonly Cell[], value: Cell): string {
  if (value === null) return "empty";
  const zeroOne = values.length > 0 && values.every((each) => each === 0 || each === 1);
  if (zeroOne && (value === 0 || value === 1)) return value === 1 ? "1 · yes" : "0 · no";
  return String(value);
}

/** A share of rows as a whole percent. A share that is not zero is never shown as 0. */
export function percentText(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  return `${Math.max(1, Math.round((part / whole) * 100))}%`;
}

/** How full of gaps a column is: `none`, `some`, or `most` from half. */
export function emptyTone(empty: number): "none" | "some" | "most" {
  if (empty <= 0) return "none";
  return empty >= 0.5 ? "most" : "some";
}

/** What the empty meter says. A column with a few gaps does not say 0%. */
export function emptyText(empty: number): string {
  if (empty <= 0) return "none empty";
  const pct = Math.round(empty * 100);
  return pct === 0 ? "<1% empty" : `${pct}% empty`;
}

/** The part of a column's profile the facts need. */
export interface ProfileFacts {
  shape: "key" | "number" | "date" | "category" | "text";
  distinct: number;
  distinct_estimate?: boolean | undefined;
  mean?: number | null | undefined;
}

/** The facts of a column in one line: its mean when it is a number, and how many values differ. A count that is an estimate starts with `~`. */
export function factsText(column: ProfileFacts): string {
  const parts: string[] = [];
  if (column.shape === "number" && column.mean !== null && column.mean !== undefined) parts.push(`mean ${numberText(column.mean, 1)}`);
  parts.push(`${column.distinct_estimate === true ? "~" : ""}${numberText(column.distinct)} distinct`);
  return parts.join(" · ");
}

/** The words under a key's bar. */
export function keyText(min: Cell | undefined, max: Cell | undefined): string {
  if (typeof min === "number" && typeof max === "number") return `unique, ${numberText(min)} … ${numberText(max)} · looks like a key`;
  return "unique · looks like a key";
}

/** The words under a text column's bar. */
export function uniqueText(ratio: number, averageLength: number | null | undefined): string {
  const pct = ratio <= 0 ? 0 : ratio >= 1 ? 100 : Math.min(99, Math.max(1, Math.round(ratio * 100)));
  const base = `${pct}% unique`;
  return averageLength === null || averageLength === undefined ? base : `${base} · ${Math.round(averageLength)} chars on average`;
}

/** The line under a text column that repeats a value. */
export function mostOftenText(value: Cell, count: number): string {
  return `most often: ${value === null ? "empty" : String(value)} (${numberText(count)}×)`;
}

/** What the rows status says: where the window is, how many rows the view has, and how many the table has. */
export function rowsStatus(first: number, last: number, total: number | null, all: number | null): string {
  if (total === null) return "reading the rows…";
  if (total === 0) return "no rows match";
  const filtered = all !== null && total < all ? ` (filtered from ${numberText(all)})` : "";
  return `rows ${numberText(first)}–${numberText(Math.min(last, total))} of ${numberText(total)}${filtered}`;
}

/** The sentence under the grid. */
export function rowsFootnote(sort: ViewSort | null, total: number | null, pagesKept: number): string {
  const sorted = sort === null || total === null ? "" : `Sorted by ${sort.column} ${sort.desc ? "descending" : "ascending"} across all ${numberText(total)} rows. `;
  return `${sorted}In memory now: ${pagesKept} page${pagesKept === 1 ? "" : "s"} of ${PAGE_ROWS} rows. Text stays on one line; click a row to read it in full.`;
}

/** What the search box finds, for its hint. */
export const SEARCH_HINT = "Find in text columns…";

/** What the grid says when the daemon cannot read the rows. */
export const ROWS_NOT_AVAILABLE = "Browsing the rows needs a newer golem. Update golem to use it.";

// -- the view as SQL ------------------------------------------------------------------------------

const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A name as SQL: bare when it is plain, in double quotes otherwise. */
export function sqlName(name: string): string {
  return PLAIN_NAME.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

/** A value as SQL. */
export function sqlValue(value: Cell): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : `'${String(value)}'`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${value.replace(/'/g, "''")}'`;
}

/** The view of a table as one SQL line, for a chat to read: `select * from titanic where Sex = 'female' order by Fare desc`. The browser never runs it. */
export function viewSql(table: string, view: { filters: readonly ViewFilter[]; search: string; sort: ViewSort | null }, textColumns: readonly string[]): string {
  const tests = view.filters.map((filter) => (filter.op === "is null" ? `${sqlName(filter.column)} is null` : `${sqlName(filter.column)} = ${sqlValue(filter.value ?? null)}`));
  const needle = view.search.trim();
  if (needle !== "" && textColumns.length > 0) {
    const any = textColumns.map((name) => `contains(lower(${sqlName(name)}), ${sqlValue(needle.toLowerCase())})`).join(" or ");
    tests.push(textColumns.length > 1 ? `(${any})` : any);
  }
  const where = tests.length === 0 ? "" : ` where ${tests.join(" and ")}`;
  const order = view.sort === null ? "" : ` order by ${sqlName(view.sort.column)}${view.sort.desc ? " desc" : ""}`;
  return `select * from ${sqlName(table)}${where}${order}`;
}

/** What a new chat starts with to ask about a view. The person finishes the question; nothing is sent. */
export function askViewText(source: string, sql: string): string {
  return `@${source} Look at \`${sql}\`: `;
}

/** The chip of a filter. */
export function filterText(filter: ViewFilter): string {
  return filter.op === "is null" ? `${filter.column} is empty` : `${filter.column} = ${filter.value === null || filter.value === undefined ? "empty" : String(filter.value)}`;
}

/** The filters with `next` in them: it replaces a filter on the same column. */
export function withFilter(filters: readonly ViewFilter[], next: ViewFilter): ViewFilter[] {
  return [...filters.filter((each) => each.column !== next.column), next];
}

// -- which rows a scroll position shows -----------------------------------------------------------

/** The rows to draw for a scroll position. */
export interface RowWindow {
  /** The first row drawn, counting the rows kept above the screen. */
  first: number;
  /** How many rows are drawn. */
  count: number;
  /** The gap above the first drawn row, in pixels. */
  top: number;
  /** The height of the whole scroll track, in pixels. */
  track: number;
  /** The first row on the screen, and the last. */
  seen: { first: number; last: number };
}

/** The rows kept above and below the screen so a scroll does not show a gap. */
export const OVERSCAN = 8;

/**
 * Which rows to draw. A table whose rows fit in the track scrolls one row per `ROW_HEIGHT`. A taller one scrolls
 * by ratio, so the scrollbar still has the whole table in it and dragging jumps to the matching row.
 */
export function rowWindow(scrollTop: number, viewport: number, total: number): RowWindow {
  const full = total * ROW_HEIGHT;
  const track = Math.min(full, MAX_SCROLL_HEIGHT);
  const onScreen = Math.max(1, Math.ceil(viewport / ROW_HEIGHT));
  const range = Math.max(1, track - viewport);
  const ratio = Math.min(1, Math.max(0, scrollTop / range));
  const firstSeen = full <= MAX_SCROLL_HEIGHT ? Math.floor(scrollTop / ROW_HEIGHT) : Math.round(ratio * Math.max(0, total - onScreen));
  const clamped = Math.max(0, Math.min(total - 1, firstSeen));
  const first = Math.max(0, clamped - OVERSCAN);
  const count = Math.max(0, Math.min(total, clamped + onScreen + OVERSCAN) - first);
  const top = full <= MAX_SCROLL_HEIGHT ? first * ROW_HEIGHT : Math.max(0, Math.min(scrollTop, track) - (clamped - first) * ROW_HEIGHT);
  return { first, count, top, track, seen: { first: clamped, last: Math.min(total - 1, clamped + onScreen - 1) } };
}

/** The scroll position that puts `row` at the top of a viewport. The inverse of `rowWindow`. */
export function scrollForRow(row: number, viewport: number, total: number): number {
  const full = total * ROW_HEIGHT;
  if (full <= MAX_SCROLL_HEIGHT) return row * ROW_HEIGHT;
  const onScreen = Math.max(1, Math.ceil(viewport / ROW_HEIGHT));
  const track = MAX_SCROLL_HEIGHT;
  return Math.round((row / Math.max(1, total - onScreen)) * Math.max(1, track - viewport));
}

/** The pages (by number) that hold rows `first` to `first + count - 1`. */
export function pagesFor(first: number, count: number): number[] {
  if (count <= 0) return [];
  const out: number[] = [];
  for (let page = Math.floor(first / PAGE_ROWS); page <= Math.floor((first + count - 1) / PAGE_ROWS); page += 1) out.push(page);
  return out;
}

/** Which pages to keep: the `KEPT_PAGES` nearest to the middle of the screen. */
export function keptPages(have: readonly number[], middle: number): number[] {
  const at = Math.floor(middle / PAGE_ROWS);
  return [...have].sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || a - b).slice(0, KEPT_PAGES);
}
