import assert from "node:assert/strict";
import { test } from "node:test";
import {
  askViewText,
  categoryLabel,
  cellText,
  edgeLabels,
  emptyText,
  emptyTone,
  factsText,
  filterText,
  isNumberType,
  keptPages,
  KEPT_PAGES,
  MAX_SCROLL_HEIGHT,
  mostOftenText,
  nextSort,
  numberText,
  pagesFor,
  PAGE_ROWS,
  percentText,
  ROW_HEIGHT,
  rowWindow,
  rowsFootnote,
  rowsStatus,
  scrollForRow,
  sqlName,
  sqlValue,
  uniqueText,
  viewSql,
  withFilter,
} from "./data-table-view.ts";

test("a header click sorts ascending, then descending, then not at all", () => {
  const first = nextSort(null, "Fare");
  assert.deepEqual(first, { column: "Fare", desc: false });
  const second = nextSort(first, "Fare");
  assert.deepEqual(second, { column: "Fare", desc: true });
  assert.equal(nextSort(second, "Fare"), null);
  assert.deepEqual(nextSort(second, "Age"), { column: "Age", desc: false });
});

test("numbers are grouped by three and rounded to two decimals", () => {
  assert.equal(numberText(891), "891");
  assert.equal(numberText(18302), "18 302");
  assert.equal(numberText(-2000000), "-2 000 000");
  assert.equal(numberText(7.25), "7.25");
  assert.equal(numberText(1234.5), "1 234.5");
  assert.equal(numberText(32.204), "32.2");
  assert.equal(numberText(29.699, 1), "29.7");
  assert.equal(cellText(null), "—");
  assert.equal(cellText(2.5), "2.5");
  assert.equal(cellText("male"), "male");
});

test("numeric types are the ones that line up on the right", () => {
  for (const type of ["BIGINT", "INTEGER", "DOUBLE", "DECIMAL(10,2)", "UTINYINT", "FLOAT"]) assert.equal(isNumberType(type), true, type);
  for (const type of ["VARCHAR", "DATE", "TIMESTAMP", "BOOLEAN"]) assert.equal(isNumberType(type), false, type);
});

test("a 0 and 1 category says no and yes, anything else is the raw value", () => {
  assert.equal(categoryLabel([0, 1], 1), "1 · yes");
  assert.equal(categoryLabel([0, 1], 0), "0 · no");
  assert.equal(categoryLabel([1, 2, 3], 1), "1");
  assert.equal(categoryLabel(["S", "C"], "S"), "S");
  assert.equal(categoryLabel(["S", null], null), "empty");
});

test("a share is never rounded down to nothing", () => {
  assert.equal(percentText(38, 100), "38%");
  assert.equal(percentText(1, 10000), "1%");
  assert.equal(percentText(0, 10), "0%");
  assert.equal(percentText(5, 0), "0%");
});

test("the empty meter is amber with some gaps and red from half", () => {
  assert.deepEqual([emptyTone(0), emptyTone(0.2), emptyTone(0.5), emptyTone(0.99)], ["none", "some", "most", "most"]);
  assert.equal(emptyText(0), "none empty");
  assert.equal(emptyText(0.197), "20% empty");
  assert.equal(emptyText(0.001), "<1% empty");
});

test("the facts say the mean of a number and an estimate starts with a tilde", () => {
  assert.equal(factsText({ shape: "number", distinct: 88, mean: 29.699 }), "mean 29.7 · 88 distinct");
  assert.equal(factsText({ shape: "category", distinct: 3, mean: 4 }), "3 distinct");
  assert.equal(factsText({ shape: "text", distinct: 53306, distinct_estimate: true }), "~53 306 distinct");
});

test("the edges of a date range show days, or times inside one day", () => {
  assert.deepEqual(edgeLabels("2020-01-01T00:00:15", "2023-12-30T23:59:01", true), ["2020-01-01", "2023-12-30"]);
  assert.deepEqual(edgeLabels("2024-03-01T08:00:00", "2024-03-01T17:30:00", true), ["2024-03-01 08:00:00", "2024-03-01 17:30:00"]);
  assert.deepEqual(edgeLabels("2024-01-02", "2026-11-24", true), ["2024-01-02", "2026-11-24"]);
  assert.deepEqual(edgeLabels(1, 1000, false), ["1", "1 000"]);
});

test("the lines under the text bars", () => {
  assert.equal(uniqueText(0.8, 26.4), "80% unique · 26 chars on average");
  assert.equal(uniqueText(0.996, null), "99% unique");
  assert.equal(uniqueText(1, 5), "100% unique · 5 chars on average");
  assert.equal(mostOftenText("same", 40), "most often: same (40×)");
});

test("the status says where the window is and what was filtered out", () => {
  assert.equal(rowsStatus(1, 14, 891, 891), "rows 1–14 of 891");
  assert.equal(rowsStatus(1, 14, 312, 891), "rows 1–14 of 312 (filtered from 891)");
  assert.equal(rowsStatus(1, 14, 0, 891), "no rows match");
  assert.equal(rowsStatus(1, 14, null, null), "reading the rows…");
  assert.equal(rowsStatus(1, 30, 12, 12), "rows 1–12 of 12");
  assert.match(rowsFootnote({ column: "Fare", desc: true }, 891, 2), /^Sorted by Fare descending across all 891 rows\. In memory now: 2 pages of 200 rows\./);
  assert.match(rowsFootnote(null, 891, 1), /^In memory now: 1 page of 200 rows\./);
});

test("names and values are quoted as SQL", () => {
  assert.equal(sqlName("Fare"), "Fare");
  assert.equal(sqlName("first name"), '"first name"');
  assert.equal(sqlName('a"b'), '"a""b"');
  assert.equal(sqlValue("it's"), "'it''s'");
  assert.equal(sqlValue(3), "3");
  assert.equal(sqlValue(true), "true");
  assert.equal(sqlValue(null), "null");
});

test("a view reads as one line of SQL", () => {
  const view = { filters: [{ column: "Sex", op: "=" as const, value: "female" }], search: "", sort: { column: "Fare", desc: true } };
  assert.equal(viewSql("titanic", view, ["Name"]), "select * from titanic where Sex = 'female' order by Fare desc");
  assert.equal(viewSql("titanic", { filters: [], search: "", sort: null }, []), "select * from titanic");
  assert.equal(viewSql("t", { filters: [{ column: "Cabin", op: "is null" }], search: "  Ann ", sort: { column: "Age", desc: false } }, ["Name", "Ticket"]), "select * from t where Cabin is null and (contains(lower(Name), 'ann') or contains(lower(Ticket), 'ann')) order by Age");
  assert.equal(viewSql("t", { filters: [], search: "x", sort: null }, ["Name"]), "select * from t where contains(lower(Name), 'x')");
  assert.equal(viewSql("t", { filters: [], search: "x", sort: null }, []), "select * from t");
});

test("asking about a view names the source and leaves the question to the person", () => {
  assert.equal(askViewText("titanic", "select * from titanic"), "@titanic Look at `select * from titanic`: ");
});

test("a filter on a column replaces the one before it", () => {
  const first = withFilter([], { column: "Sex", op: "=", value: "male" });
  const second = withFilter(first, { column: "Pclass", op: "=", value: 1 });
  assert.deepEqual(withFilter(second, { column: "Sex", op: "=", value: "female" }).map(filterText), ["Pclass = 1", "Sex = female"]);
  assert.equal(filterText({ column: "Cabin", op: "is null" }), "Cabin is empty");
});

test("a table that fits the track scrolls a row at a time", () => {
  const window = rowWindow(ROW_HEIGHT * 100, 320, 891);
  assert.equal(window.seen.first, 100);
  assert.equal(window.seen.last, 109);
  assert.ok(window.first <= 100 && window.first + window.count > 109);
  assert.equal(window.top, window.first * ROW_HEIGHT);
  assert.equal(window.track, 891 * ROW_HEIGHT);
  assert.equal(rowWindow(0, 320, 891).first, 0);
});

test("a table taller than the track scrolls by ratio, and the end of the track is the last row", () => {
  const total = 2_000_000;
  const viewport = 480;
  const start = rowWindow(0, viewport, total);
  assert.equal(start.seen.first, 0);
  assert.equal(start.track, MAX_SCROLL_HEIGHT);
  const middle = rowWindow((MAX_SCROLL_HEIGHT - viewport) / 2, viewport, total);
  assert.ok(Math.abs(middle.seen.first - total / 2) < 20, String(middle.seen.first));
  const end = rowWindow(MAX_SCROLL_HEIGHT - viewport, viewport, total);
  assert.equal(end.seen.last, total - 1);
  assert.ok(end.first + end.count <= total);
  assert.ok(end.top >= 0);
});

test("scrolling to a row lands the window on it", () => {
  for (const total of [891, 2_000_000]) {
    for (const row of [0, 1, 500, total - 20]) {
      const found = rowWindow(scrollForRow(row, 480, total), 480, total);
      assert.ok(Math.abs(found.seen.first - row) <= (total > 100_000 ? 3 : 0), `${total} ${row} ${found.seen.first}`);
    }
  }
});

test("a window asks for the pages it touches and keeps the nearest few", () => {
  assert.deepEqual(pagesFor(0, 20), [0]);
  assert.deepEqual(pagesFor(190, 20), [0, 1]);
  assert.deepEqual(pagesFor(0, 0), []);
  assert.deepEqual(pagesFor(PAGE_ROWS * 3, PAGE_ROWS), [3]);
  assert.deepEqual(keptPages([0, 1, 2, 3, 4], PAGE_ROWS * 3 + 5), [3, 2, 4].slice(0, KEPT_PAGES));
  assert.deepEqual(keptPages([5], 0), [5]);
});
