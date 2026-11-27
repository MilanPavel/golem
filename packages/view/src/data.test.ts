import assert from "node:assert/strict";
import { test } from "node:test";

import { askText, columnStats, countText, groupSources, inspectSummary, kindGlyph, kindWord, sampleCaption, sourceDetail, sourceFileType, stepName, type DataSourceLike } from "./data.ts";

const source = (over: Partial<DataSourceLike> = {}): DataSourceLike => ({ name: "bank", kind: "files", scope: "user", privacy: "local", status: "ready", ...over });

test("a ready source says its tables and rows", () => {
  assert.equal(sourceDetail(source({ tables: 3, rows: 18302 })), "3 tables · 18 302 rows");
  assert.equal(sourceDetail(source({ tables: 1 })), "1 table");
  assert.equal(sourceDetail(source({ tables: null, rows: null })), "");
});

test("a source that cannot be used says why", () => {
  assert.equal(sourceDetail(source({ status: "reading" })), "reading…");
  assert.equal(sourceDetail(source({ status: "untrusted" })), "untrusted — trust this folder to use it");
  assert.equal(sourceDetail(source({ status: "error", error: "no such file" })), "no such file");
  assert.equal(sourceDetail(source({ status: "error" })), "could not be read");
});

test("sources group by the folder in view, and the built-in one is yours", () => {
  const list = [source({ name: "a", scope: "project", project: "/w/shop" }), source({ name: "b", scope: "project", project: "/w/other" }), source({ name: "c" }), source({ name: "golem", kind: "builtin", scope: "builtin" })];
  const groups = groupSources(list, "/w/shop");
  assert.deepEqual(groups.project?.map((s) => s.name), ["a"]);
  assert.deepEqual(groups.yours.map((s) => s.name), ["c", "golem"]);
  assert.equal(groupSources(list, null).project, null);
});

test("the sample caption follows the privacy", () => {
  assert.equal(sampleCaption("open"), "you and every model");
  assert.equal(sampleCaption("local"), "you and local models");
  assert.equal(sampleCaption("schema"), "only you, on request");
});

test("a column's stats read in one line", () => {
  assert.equal(columnStats({ min: "1", max: "9", distinct: 4, null_fraction: 0.12 }), "1 … 9 · 4 distinct · 12% empty");
  assert.equal(columnStats({ distinct: 6120 }), "6 120 distinct");
  assert.equal(columnStats({ null_fraction: 0 }), "");
});

test("small words", () => {
  assert.equal(countText(40122881), "40 122 881");
  assert.equal(askText("bank"), "@bank ");
  assert.equal(kindWord("postgres"), "PostgreSQL");
  assert.equal(stepName("where"), "2 · where");
  assert.equal(inspectSummary({ files: 36, tables: [{ name: "transactions" }] }), "36 files match, one table: transactions.");
  assert.equal(inspectSummary({ tables: [] }), "Found no tables.");
});

test("the type of a source's files comes from its location", () => {
  assert.equal(sourceFileType("~/Documents/bank/*.csv"), "csv");
  assert.equal(sourceFileType("a.TSV"), "csv");
  assert.equal(sourceFileType("~/receipts/*.xlsx"), "excel");
  assert.equal(sourceFileType("a.parquet"), "parquet");
  assert.equal(sourceFileType("./var/log/*.jsonl"), "json");
  assert.equal(sourceFileType("data.json"), "json");
  assert.equal(sourceFileType("logs/"), "folder");
  assert.equal(sourceFileType("~/Documents/bank"), "folder");
  assert.equal(sourceFileType("~/Documents/bank/*"), "folder");
  assert.equal(sourceFileType("a.db"), "sheet");
  assert.equal(sourceFileType(""), "sheet");
  assert.equal(sourceFileType("https://example.com/data.csv?download=1"), "csv");
  assert.equal(sourceFileType("https://example.com/export.parquet#top"), "parquet");
});

test("every kind has a one-character glyph for the terminal", () => {
  for (const kind of ["builtin", "files", "sqlite", "duckdb", "postgres", "mysql", "url"] as const) assert.equal([...kindGlyph(kind)].length, 1);
});
