import assert from "node:assert/strict";
import { test } from "node:test";

import { chartCutNote, chartPoints, columnAlign, cutCell, formatCell, modelSawText, nextOffset, pickChart, previousOffset, resultHeader, rowRangeText, sortRows } from "./data-result.ts";

const cols = (...types: string[]) => types.map((type, at) => ({ name: `c${at}`, type }));

test("a text or date column with numbers is a chart, anything else is not", () => {
  assert.deepEqual(pickChart(cols("VARCHAR", "BIGINT")), { kind: "bar", label: 0, values: [1] });
  assert.deepEqual(pickChart(cols("VARCHAR", "DECIMAL(18,3)", "DOUBLE")), { kind: "bar", label: 0, values: [1, 2] });
  assert.deepEqual(pickChart(cols("DATE", "INTEGER")), { kind: "line", label: 0, values: [1] });
  assert.deepEqual(pickChart(cols("TIMESTAMP WITH TIME ZONE", "BIGINT")), { kind: "line", label: 0, values: [1] });
  assert.deepEqual(pickChart(cols("BIGINT", "VARCHAR")), { kind: "bar", label: 1, values: [0] });
  assert.equal(pickChart(cols("VARCHAR")), null);
  assert.equal(pickChart(cols("BIGINT", "DOUBLE")), null);
  assert.equal(pickChart(cols("VARCHAR", "VARCHAR", "BIGINT")), null);
  assert.equal(pickChart(cols("INTERVAL", "BIGINT")) !== null, true);
  assert.equal(pickChart([]), null);
});

test("numbers align right and are grouped, NULL is its own kind, text is as it is", () => {
  assert.equal(columnAlign("BIGINT"), "right");
  assert.equal(columnAlign("DECIMAL(10,2)"), "right");
  assert.equal(columnAlign("VARCHAR"), "left");
  assert.equal(columnAlign("DATE"), "left");
  assert.deepEqual(formatCell(18302), { text: "18\u00a0302", kind: "number" });
  assert.deepEqual(formatCell(-1234567), { text: "-1\u00a0234\u00a0567", kind: "number" });
  assert.deepEqual(formatCell(1234.5678), { text: "1\u00a0234.57", kind: "number" });
  assert.deepEqual(formatCell(0.000123), { text: "0.000123", kind: "number" });
  assert.deepEqual(formatCell(null), { text: "NULL", kind: "null" });
  assert.deepEqual(formatCell(true), { text: "true", kind: "boolean" });
  assert.deepEqual(formatCell("2026-11-01"), { text: "2026-11-01", kind: "text" });
});

test("a long text is cut with an ellipsis and says so", () => {
  assert.deepEqual(cutCell("short", 10), { text: "short", cut: false });
  assert.deepEqual(cutCell("abcdefghijkl", 5), { text: "abcd…", cut: true });
});

test("sorting a page puts NULL last either way and keeps ties in order", () => {
  const rows = [["b", 10], ["a", 2], ["c", null], ["d", 2], ["e", 33]] as const;
  assert.deepEqual(sortRows(rows, 1, "BIGINT", false).map((row) => row[0]), ["a", "d", "b", "e", "c"]);
  assert.deepEqual(sortRows(rows, 1, "BIGINT", true).map((row) => row[0]), ["e", "b", "a", "d", "c"]);
  assert.deepEqual(sortRows(rows, 0, "VARCHAR", true).map((row) => row[0]), ["e", "d", "c", "b", "a"]);
  assert.deepEqual(sortRows([["x", "9"], ["y", "10"]], 1, "DECIMAL", false).map((row) => row[0]), ["x", "y"]);
});

test("a page says its range, and the offsets of its neighbours", () => {
  assert.equal(rowRangeText(0, 9, 9), "9 rows");
  assert.equal(rowRangeText(0, 1, 1), "1 row");
  assert.equal(rowRangeText(0, 50, 18302), "1–50 of 18\u00a0302 rows");
  assert.equal(rowRangeText(18250, 52, 18302), "18\u00a0251–18\u00a0302 of 18\u00a0302 rows");
  assert.equal(nextOffset(0, 50, 120), 50);
  assert.equal(nextOffset(100, 50, 120), null);
  assert.equal(previousOffset(0, 50), null);
  assert.equal(previousOffset(20, 50), 0);
  assert.equal(previousOffset(100, 50), 50);
});

test("a chart stops at 50 bars or 1000 points and says how many it left out", () => {
  const bars = Array.from({ length: 60 }, (_, at) => [`n${at}`, at] as const);
  const data = chartPoints(bars, { kind: "bar", label: 0, values: [1] }, 1);
  assert.equal(data.points.length, 50);
  assert.equal(data.cut, 10);
  const days = Array.from({ length: 1200 }, (_, at) => [`d${at}`, String(at)] as const);
  const line = chartPoints(days, { kind: "line", label: 0, values: [1] }, 1);
  assert.equal(line.points.length, 1000);
  assert.equal(line.cut, 200);
  assert.equal(chartPoints([["a", null], ["b", 3]], { kind: "bar", label: 0, values: [1] }, 1).points.length, 1);
  assert.equal(chartCutNote("bar", 10), "Only the first 50 bars are drawn. 10 more rows are in the table.");
  assert.equal(chartCutNote("line", 1), "Only the first 1\u00a0000 points are drawn. 1 more row is in the table.");
});

test("the stub the model got and the header of the table", () => {
  const result = { result_id: "r_7f2", source: "bank", columns: [{ name: "name", type: "VARCHAR" }, { name: "total", type: "DECIMAL" }], total_rows: 9 };
  assert.equal(modelSawText(result), 'result r_7f2: 9 rows × 2 cols, shown to the user.\nrows not sent: the privacy of @bank keeps them off this model.\ncolumns: name VARCHAR, total DECIMAL');
  assert.equal(resultHeader(result), "table · 9 rows · from @bank");
  assert.equal(resultHeader({ ...result, truncated: true }), "table · 9 rows · from @bank · the query had more rows than were kept");
});
