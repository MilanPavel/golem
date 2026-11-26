import assert from "node:assert/strict";
import { test } from "node:test";

import { countText, type ChatMessage, type ToolBlock, type ToolTable } from "@golem/view";

import { COLLAPSED_ROWS, pageableResult, pageOffset, PAGE_ROWS, resultFooter, tableLines, WITHHELD_LINE, type Cell } from "./data-table.ts";
import { toolLines, type Span } from "./layout-chat.ts";

const text = (spans: readonly Span[]): string => spans.map((span) => span.text).join("");

const COLUMNS = [
  { name: "name", type: "VARCHAR" },
  { name: "months", type: "BIGINT" },
  { name: "per_month", type: "DECIMAL" },
  { name: "last_charge", type: "DATE" },
];
const ROWS: Cell[][] = [
  ["Adobe CC", 11, "62.99", "2026-11-08"],
  ["Headspace", 9, "12.99", null],
];

function table(extra: Partial<ToolTable> = {}): ToolTable {
  return { result_id: "r_7f2", source: "bank", columns: COLUMNS, rows: ROWS, total_rows: 2, truncated: false, ...extra };
}

function block(extra: Partial<ToolBlock> = {}, tableExtra: Partial<ToolTable> = {}): ToolBlock & { table: ToolTable } {
  return { callId: "c1", name: "data_query", args: { source: "bank" }, status: "done", summary: "2 rows", durationMs: 120, table: table(tableExtra), ...extra };
}

test("columns line up, numbers sit to the right and NULL is dim", () => {
  const laid = tableLines(COLUMNS, ROWS, 80);
  assert.deepEqual(laid.lines.map(text), [
    "  name       months  per_month  last_charge",
    "  ─────────  ──────  ─────────  ───────────",
    "  Adobe CC       11      62.99  2026-11-08",
    "  Headspace       9      12.99  NULL",
  ]);
  assert.equal(laid.hidden, 0);
  const nullCell = laid.lines[3]?.find((span) => span.text.includes("NULL"));
  assert.equal(nullCell?.dim, true);
});

test("every row fits the width at 80 and 120 columns, with long text cut by an ellipsis", () => {
  const long: Cell[][] = [["A very long subscription name that goes on and on and on", 1, "1.00", "2026-01-01"]];
  for (const width of [80, 120, 40]) {
    const lines = tableLines(COLUMNS, long, width).lines.map(text);
    for (const line of lines) assert.ok([...line].length <= width, `${width}: ${line}`);
  }
  assert.match(tableLines(COLUMNS, long, 60).lines.map(text).join("\n"), /A very long.*…/);
  assert.doesNotMatch(tableLines(COLUMNS, [["A long subscription name", 1, "1.00", "2026-01-01"]], 120).lines.map(text).join("\n"), /…/);
});

test("columns that cannot fit even cut short are left out and counted", () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ name: `column_${index}` }));
  const laid = tableLines(many, [many.map((_, index) => index)], 30);
  assert.ok(laid.hidden > 0);
  for (const line of laid.lines.map(text)) assert.ok(line.length <= 30);
});

test("control characters and line breaks in a cell are shown on one row", () => {
  const laid = tableLines([{ name: "note" }], [["one\ntwo\u001b[31m"]], 40);
  assert.equal(laid.lines.length, 3);
  assert.match(text(laid.lines[2] ?? []), /one two␛\[31m/);
});

test("the block is the head, the table and a footer: N of M rows, source, time", () => {
  const lines = toolLines(block(), 80, false).map(text);
  assert.deepEqual(lines, [
    "data_query bank ✓  2 rows",
    "  name       months  per_month  last_charge",
    "  ─────────  ──────  ─────────  ───────────",
    "  Adobe CC       11      62.99  2026-11-08",
    "  Headspace       9      12.99  NULL",
    "  2 of 2 rows · bank · 0.12 s",
  ]);
});

test("a result of more rows than are shown says so, and points to Ctrl-O", () => {
  const rows = Array.from({ length: 50 }, (_, index): Cell[] => [`n${index}`, index, "1.00", "2026-01-01"]);
  const closed = toolLines(block({}, { rows, total_rows: 120, truncated: true }), 120, false).map(text);
  assert.equal(closed.length, 1 + 2 + COLLAPSED_ROWS + 1);
  assert.equal(closed.at(-1), "  20 of 120 rows · bank · 0.12 s · more rows than golem kept · ctrl+o to page");
});

test("rows the model did not get are said under the footer", () => {
  const lines = toolLines(block({ rowsWithheld: true }), 80, false).map(text);
  assert.equal(lines.at(-1), `  ${WITHHELD_LINE}`);
  assert.equal(toolLines(block(), 80, false).map(text).includes(`  ${WITHHELD_LINE}`), false);
});

test("an open result shows the page it was moved to, with its row range", () => {
  const rows = Array.from({ length: 50 }, (_, index): Cell[] => [`n${index}`, index, "1.00", "2026-01-01"]);
  const tool = block({}, { rows, total_rows: 60 });
  const second = toolLines(tool, 120, true, "normal", { offset: 20, rows: rows.slice(20, 40) }).map(text);
  assert.match(second[3] ?? "", /^ {2}n20 /);
  assert.equal(second.at(-1), "  21–40 of 60 rows · bank · 0.12 s · PgUp/PgDn");
  const first = toolLines(tool, 120, true).map(text);
  assert.equal(first.at(-1), "  20 of 60 rows · bank · 0.12 s · PgUp/PgDn");
  assert.equal(resultFooter(table({ total_rows: 18302 }), 0, 20, undefined), `20 of ${countText(18302)} rows · bank`);
});

test("paging moves by 20 rows and stops at both ends", () => {
  const long = table({ total_rows: 50 });
  assert.equal(pageOffset(long, 0, "down"), PAGE_ROWS);
  assert.equal(pageOffset(long, 20, "down"), 40);
  assert.equal(pageOffset(long, 40, "down"), null);
  assert.equal(pageOffset(long, 40, "up"), 20);
  assert.equal(pageOffset(long, 0, "up"), null);
  assert.equal(pageOffset(long, 10, "up"), 0);
});

test("the newest result with more than one page is the one the Page keys move", () => {
  const short = block({ callId: "short" });
  const long = block({ callId: "long" }, { total_rows: 90 });
  const messages: ChatMessage[] = [
    { id: "1", role: "assistant", text: "", streaming: false, tools: [long] },
    { id: "2", role: "assistant", text: "", streaming: false, tools: [short] },
  ];
  assert.equal(pageableResult(messages)?.callId, "long");
  assert.equal(pageableResult([messages[1] as ChatMessage]), null);
});
