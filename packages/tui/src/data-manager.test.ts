import assert from "node:assert/strict";
import { test } from "node:test";

import { RpcError, type DataDescribeResult, type DataSource } from "@golem/client";

import {
  closedDataManager,
  dataFailed,
  dataManagerKeyOf,
  detailLines,
  layoutDataManager,
  NO_DATA_METHODS,
  openDataManager,
  orderedSources,
  pressDataManager,
  type DataDetail,
  type DataList,
  type DataManagerKey,
  type DataManagerState,
  type DataScreen,
} from "./data-manager.ts";

function source(name: string, extra: Partial<DataSource> = {}): DataSource {
  return { name, kind: "files", location: `~/${name}`, privacy: "local", scope: "user", status: "ready", tables: 1, rows: 120, ...extra };
}

const SOURCES: DataSource[] = [
  source("bank", { rows: 18302 }),
  source("shop_prod", { kind: "postgres", scope: "project", project: "/work/shop-api", privacy: "schema", tables: 14, rows: null }),
  source("broken", { status: "error", error: "no such file", tables: null, rows: null }),
];

function screen(list: DataList, detail: DataDetail | null = null, rows = 24): DataScreen {
  return { list, detail, folder: "/work/shop-api", columns: 80, rows };
}

const LIST: DataList = { sources: SOURCES, error: null };

function press(state: DataManagerState, on: DataScreen, ...keys: DataManagerKey[]) {
  let current = state;
  let action: ReturnType<typeof pressDataManager>["action"] = { kind: "none" };
  for (const key of keys) {
    const pressed = pressDataManager(current, on, key);
    current = pressed.state;
    action = pressed.action;
  }
  return { state: current, action };
}

const texts = (lines: readonly { text: string }[]): string[] => lines.map((line) => line.text);

test("the list groups this project's sources before yours, and shows size, privacy and errors", () => {
  assert.deepEqual(orderedSources(SOURCES, "/work/shop-api").map((each) => each.name), ["shop_prod", "bank", "broken"]);
  const lines = layoutDataManager({ state: openDataManager(), screen: screen(LIST) });
  const rows = texts(lines);
  assert.ok(rows.includes("  this project · shop-api"));
  assert.ok(rows.includes("  yours · every chat"));
  assert.match(rows.find((row) => row.startsWith("shop_prod")) ?? "", /^shop_prod {2}PostgreSQL {2}14 tables +schema only$/);
  assert.match(rows.find((row) => row.startsWith("bank")) ?? "", /18.302 rows {2}rows local$/);
  assert.match(rows.find((row) => row.startsWith("broken")) ?? "", /no such file$/);
  assert.equal(lines.find((line) => line.text.startsWith("shop_prod"))?.prefix, "❯ ");
  assert.equal(rows.at(-1), "↑/↓ to navigate · Enter to open · Esc to close");
});

test("with no sources the list says how to add one", () => {
  const rows = texts(layoutDataManager({ state: openDataManager(), screen: screen({ sources: [], error: null }) }));
  assert.ok(rows.includes("no data sources"));
});

test("arrows move the pointer, Enter opens the source under it, and Esc closes", () => {
  const on = screen(LIST);
  assert.deepEqual(press(openDataManager(), on, "down").state.view, { kind: "list", selected: 1 });
  assert.deepEqual(press(openDataManager(), on, "up").state.view, { kind: "list", selected: 0 });
  const opened = press(openDataManager(), on, "down", "enter");
  assert.deepEqual(opened.action, { kind: "open", name: "bank" });
  assert.deepEqual(opened.state.view, { kind: "detail", name: "bank", scroll: 0 });
  const closed = press(openDataManager(), on, "back");
  assert.deepEqual(closed.action, { kind: "close" });
  assert.equal(closed.state.open, false);
});

test("Esc in a source goes back to the list with the pointer on it", () => {
  const on = screen(LIST);
  const back = press(openDataManager("bank"), on, "back");
  assert.deepEqual(back.action, { kind: "back" });
  assert.deepEqual(back.state, { open: true, view: { kind: "list", selected: 1 } });
});

test("/data name opens that source directly", () => {
  assert.deepEqual(openDataManager("bank"), { open: true, view: { kind: "detail", name: "bank", scroll: 0 } });
  assert.deepEqual(openDataManager(), { open: true, view: { kind: "list", selected: 0 } });
  assert.deepEqual(closedDataManager, { open: false, view: { kind: "list", selected: 0 } });
});

const RESULT: DataDescribeResult = {
  source: source("bank", { rows: 18302 }),
  tables: [
    {
      name: "transactions",
      rows: 18302,
      columns: [
        { name: "date", type: "DATE", min: "2024-01-02", max: "2026-11-24" },
        { name: "description", type: "VARCHAR", distinct: 6120 },
        { name: "amount", type: "DECIMAL" },
      ],
    },
  ],
  sample: { transactions: [["2026-11-24", "Spotify", 10.99], ["2026-11-22", null, 13.99]] },
  notes: "Money in euros.",
  queries: [{ name: "subscriptions", sql: "select 1" }],
};

test("a source shows its tables with columns and types, the sample rows, notes and saved queries", () => {
  const rows = texts(detailLines({ name: "bank", result: RESULT, error: null }, "bank", 80));
  assert.equal(rows[0], "bank  files · rows local");
  assert.ok(rows.includes("transactions  18 302 rows".replace(" ", " ").replace(/(\d) (\d)/, "$1 $2")) || rows.some((row) => row.startsWith("transactions")));
  assert.ok(rows.some((row) => /^ {4}date {9}DATE {5}2024-01-02 … 2026-11-24$/.test(row)));
  assert.ok(rows.some((row) => /^ {4}description {2}VARCHAR {2}6.120 distinct$/.test(row)));
  assert.ok(rows.includes("  sample · you and local models"));
  assert.ok(rows.some((row) => /Spotify/.test(row)));
  assert.ok(rows.some((row) => /NULL/.test(row)));
  assert.ok(rows.includes("  Money in euros."));
  assert.ok(rows.includes("  subscriptions"));
});

test("a schema-only source says no rows are fetched", () => {
  const result: DataDescribeResult = { ...RESULT, source: source("shop_prod", { privacy: "schema" }), sample: {}, notes: null, queries: [] };
  const rows = texts(detailLines({ name: "shop_prod", result, error: null }, "shop_prod", 80));
  assert.ok(rows.some((row) => row.includes("Schema only: golem fetches no rows")));
});

test("a source that is still being asked for or failed says so", () => {
  assert.ok(texts(detailLines(null, "bank", 80)).includes("asking the daemon…"));
  assert.ok(texts(detailLines({ name: "bank", result: null, error: NO_DATA_METHODS }, "bank", 80)).includes(NO_DATA_METHODS));
});

test("a long source scrolls with the arrows and the Page keys, and stops at its end", () => {
  const detail: DataDetail = { name: "bank", result: RESULT, error: null };
  const on = screen(LIST, detail, 8);
  const down = press(openDataManager("bank"), on, "down");
  assert.deepEqual(down.state.view, { kind: "detail", name: "bank", scroll: 1 });
  const far = press(openDataManager("bank"), on, "page-down", "page-down", "page-down", "page-down", "page-down");
  const total = detailLines(detail, "bank", 80).length;
  assert.deepEqual(far.state.view, { kind: "detail", name: "bank", scroll: total - 6 });
  assert.deepEqual(press(far.state, on, "page-up", "page-up", "page-up", "page-up", "page-up").state.view, { kind: "detail", name: "bank", scroll: 0 });
  const shown = layoutDataManager({ state: far.state, screen: on });
  assert.equal(shown.length, 8);
});

test("a daemon without the data methods gets one plain line, other errors keep their text", () => {
  assert.equal(dataFailed(new RpcError(-32601, "Method not found")), "This golem daemon does not know data sources yet.");
  assert.equal(dataFailed(new RpcError(-32000, "boom")), "boom");
  assert.equal(dataFailed("x"), "request failed");
  const rows = texts(layoutDataManager({ state: openDataManager(), screen: screen({ sources: null, error: NO_DATA_METHODS }) }));
  assert.ok(rows.includes(NO_DATA_METHODS));
});

test("keys map to the manager's keys", () => {
  const key = (name: string | null) => dataManagerKeyOf({ name: name as never, input: "", ctrl: false, meta: false });
  assert.equal(key("up"), "up");
  assert.equal(key("page-down"), "page-down");
  assert.equal(key("return"), "enter");
  assert.equal(key("escape"), "back");
  assert.equal(key(null), null);
});
