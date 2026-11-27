import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalQuestion } from "./activity.ts";
import { countText } from "./data.ts";
import { defaultExportPath, exportedText, exportHeading, formatOfPath, withFormat } from "./data-export.ts";

test("the name a dialog starts with is the source, today's local date and the ending of the format", () => {
  const day = new Date(2026, 10, 5, 23, 59);
  assert.equal(defaultExportPath("bank", day, "csv"), "~/Downloads/bank-2026-11-05.csv");
  assert.equal(defaultExportPath("bank", day, "xlsx"), "~/Downloads/bank-2026-11-05.xlsx");
  assert.equal(defaultExportPath("", day, "json"), "~/Downloads/result-2026-11-05.json");
});

test("a format follows the ending of a name, and a name follows a format", () => {
  assert.equal(formatOfPath("a/b.CSV"), "csv");
  assert.equal(formatOfPath("b.jsonl"), "json");
  assert.equal(formatOfPath("b.txt"), null);
  assert.equal(formatOfPath("b"), null);
  assert.equal(withFormat("~/Downloads/bank.csv", "parquet"), "~/Downloads/bank.parquet");
  assert.equal(withFormat("~/Downloads/bank.jsonl", "json"), "~/Downloads/bank.jsonl");
  assert.equal(withFormat("~/Downloads/bank.v2", "csv"), "~/Downloads/bank.v2.csv");
  assert.equal(withFormat("", "csv"), "");
});

test("the lines say how many rows and where", () => {
  assert.equal(exportedText(9, "~/a.csv"), "Wrote 9 rows to ~/a.csv.");
  assert.equal(exportedText(1, "~/a.csv"), "Wrote 1 row to ~/a.csv.");
  assert.equal(exportHeading(18302, "bank"), `${countText(18302)} rows from @bank`);
});

test("an export asks as a write, not as the tool's name", () => {
  assert.equal(approvalQuestion("data_export", { result: "r1", path: "~/a.csv" }), "golem wants to write a file");
});
