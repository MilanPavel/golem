import assert from "node:assert/strict";
import { test } from "node:test";

import { RpcError, type DataDescribeResult, type DataQueryParams, type DataResult } from "@golem/client";

import { DATA_HELP, parseDataArgs } from "./data-command.ts";
import {
  formatDataDescribe,
  formatDataList,
  formatQueryCsv,
  formatQueryJson,
  formatQueryTable,
  truncatedNote,
} from "./data-format.ts";
import { NO_DATA_METHODS, runDataAdd, runDataDescribe, runDataExport, runDataList, runDataNotes, runDataQuery, type DataDeps } from "./data-run.ts";
import { explainDaemonDown } from "./daemon-down.ts";

const GOLEM = { name: "golem", kind: "builtin", scope: "builtin", location: "golem", privacy: "open", status: "ready", tables: 2, rows: 1204 } as const;
const BANK = { name: "bank", kind: "files", scope: "user", location: "~/bank/*.csv", privacy: "local", status: "ready", tables: 1, rows: 40 } as const;
const BROKEN = { name: "old", kind: "sqlite", scope: "project", location: "./old.db", privacy: "schema", status: "error", error: "file not found" } as const;

const SPEND: DataResult = {
  result_id: "r1",
  source: "golem",
  columns: [
    { name: "model", type: "VARCHAR" },
    { name: "cost", type: "DOUBLE" },
  ],
  rows: [
    ["qwen3", 1.5],
    ["opus, big", 12.25],
    ["none", null],
  ],
  total_rows: 3,
  truncated: false,
  elapsed_ms: 120,
};

test("the list is one aligned line per source, with the error of a broken one", () => {
  assert.equal(formatDataList([]), "no data sources");
  const one = formatDataList([GOLEM]).split("\n");
  assert.match(one[0] ?? "", /^NAME +KIND +SCOPE +TABLES +ROWS +PRIVACY +STATUS$/);
  assert.match(one[1] ?? "", /^golem +built in +builtin +2 +1\s204 +rows open +ready$/);
  const several = formatDataList([GOLEM, BANK, BROKEN]).split("\n");
  assert.equal(several.length, 4);
  assert.match(several[2] ?? "", /^bank +files +user +1 +40 +rows local +ready$/);
  assert.match(several[3] ?? "", /^old +SQLite +project +- +- +schema only +error: file not found$/);
});

test("describe shows tables, columns with stats, sample rows and the notes", () => {
  const result: DataDescribeResult = {
    source: BANK,
    tables: [
      {
        name: "transactions",
        rows: 40,
        columns: [
          { name: "amount", type: "DOUBLE", min: "-900", max: "20", distinct: 30, null_fraction: 0 },
          { name: "memo", type: "VARCHAR" },
        ],
      },
    ],
    sample: { transactions: [[-12.5, "coffee"]] },
    notes: "# bank\nMy account.",
    queries: [{ name: "subscriptions", sql: "select 1" }],
  };
  const text = formatDataDescribe(result);
  assert.match(text, /^bank {2}files · user · rows local · 1 table · 40 rows\n {2}~\/bank\/\*\.csv/);
  assert.match(text, /transactions {2}40 rows/);
  assert.match(text, / {2}amount {2}DOUBLE +-900 to 20 · 30 distinct · 0% empty/);
  assert.match(text, /sample, 1 row\n {2}amount {2}memo\n/);
  assert.match(text, / {2}-12.5 {2}coffee/);
  assert.match(text, /notes\n {2}# bank\n {2}My account\./);
  assert.match(text, /saved queries\n {2}subscriptions/);
});

test("a query prints an aligned table with numbers to the right, then the count and time", () => {
  const lines = formatQueryTable(SPEND).split("\n");
  assert.equal(lines[0], "model       cost");
  assert.equal(lines[1], "─────────  ─────");
  assert.equal(lines[2], "qwen3        1.5");
  assert.equal(lines[4], "none        NULL");
  assert.equal(lines.at(-2), "");
  assert.equal(lines.at(-1), "3 rows · 0.12 s");
});

test("the footer says first N of M rows when the result was cut", () => {
  const cut = { ...SPEND, rows: SPEND.rows.slice(0, 2), total_rows: 1500, truncated: true };
  assert.match(formatQueryTable(cut), /\nfirst 2 of 1\s500 rows · 0\.12 s$/);
  assert.match(formatQueryTable({ ...cut, total_rows: null }), /\nfirst 2 rows · 0\.12 s$/);
  assert.match(truncatedNote(cut) ?? "", /^first 2 of 1\s500 rows$/);
  assert.equal(truncatedNote(SPEND), null);
  assert.match(formatQueryTable({ ...SPEND, rows: [["a", 1]], total_rows: 1 }), /\n1 row · 0\.12 s$/);
});

test("csv quotes what needs it and json is an array of objects, neither with a footer", () => {
  assert.equal(formatQueryCsv(SPEND), 'model,cost\nqwen3,1.5\n"opus, big",12.25\nnone,');
  assert.deepEqual(JSON.parse(formatQueryJson(SPEND)), [
    { model: "qwen3", cost: 1.5 },
    { model: "opus, big", cost: 12.25 },
    { model: "none", cost: null },
  ]);
});

test("the arguments: list, describe, query, and what is refused", () => {
  assert.deepEqual(parseDataArgs([]), { kind: "list", json: false });
  assert.deepEqual(parseDataArgs(["list", "--json"]), { kind: "list", json: true });
  assert.deepEqual(parseDataArgs(["--json"]), { kind: "list", json: true });
  assert.deepEqual(parseDataArgs(["describe", "bank", "transactions", "--json"]), { kind: "describe", source: "bank", table: "transactions", json: true });
  assert.deepEqual(parseDataArgs(["describe", "bank"]), { kind: "describe", source: "bank", table: null, json: false });
  assert.deepEqual(parseDataArgs(["query", "golem", "select 1", "--limit", "5", "--format", "csv"]), {
    kind: "query",
    source: "golem",
    sql: "select 1",
    limit: 5,
    format: "csv",
  });
  assert.deepEqual(parseDataArgs(["query", "golem", "-"]), { kind: "query", source: "golem", sql: null, limit: null, format: "table" });
  assert.deepEqual(parseDataArgs(["query", "golem"]), { kind: "query", source: "golem", sql: null, limit: null, format: "table" });
  assert.deepEqual(parseDataArgs(["data", "--help"]), { kind: "help" });
  assert.deepEqual(parseDataArgs(["query", "--help"]), { kind: "help" });
  for (const bad of [["query"], ["query", "golem", "a", "b"], ["describe"], ["describe", "a", "b", "c"], ["nope"], ["list", "x"]]) {
    assert.equal(parseDataArgs(bad).kind, "error", bad.join(" "));
  }
});

test("--format and --limit are checked", () => {
  assert.deepEqual(parseDataArgs(["query", "golem", "select 1", "--format", "xml"]), { kind: "error", message: "--format is table, csv, json" });
  assert.deepEqual(parseDataArgs(["query", "golem", "select 1", "--limit", "0"]), { kind: "error", message: "--limit is a whole number, 1 or more" });
  assert.deepEqual(parseDataArgs(["query", "golem", "select 1", "--limit", "x"]), { kind: "error", message: "--limit is a whole number, 1 or more" });
  assert.deepEqual(parseDataArgs(["query", "golem", "select 1", "--format"]), { kind: "error", message: "--format needs a value" });
  assert.equal(parseDataArgs(["query", "golem", "select 1", "--wat"]).kind, "error");
});

interface Harness {
  deps: DataDeps;
  out: string[];
  err: string[];
  interrupt: () => void;
}

function harness(options: { tty?: boolean; stdin?: string; password?: string; prompts?: string[] } = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  let handler: (() => void) | null = null;
  return {
    out,
    err,
    interrupt: () => handler?.(),
    deps: {
      write: (text) => out.push(text),
      error: (line) => err.push(line),
      stdinIsTty: options.tty ?? false,
      readStdin: async () => options.stdin ?? "",
      ...(options.password === undefined
        ? {}
        : {
            readPassword: async (prompt: string) => {
              options.prompts?.push(prompt);
              return options.password ?? "";
            },
          }),
      onInterrupt: (next) => {
        handler = next;
        return () => {
          handler = null;
        };
      },
      newId: () => "cli-fixed",
    },
  };
}

function client(overrides: Partial<Record<"addData" | "listData" | "describeData" | "queryData" | "cancelData" | "getDataNotes" | "setDataNotes" | "exportDataResult", (...args: never[]) => unknown>> = {}) {
  return {
    listData: async () => ({ sources: [GOLEM] }),
    describeData: async () => ({ source: GOLEM, tables: [], sample: {} }),
    queryData: async () => SPEND,
    cancelData: async () => ({}),
    ...overrides,
  } as never;
}

test("list prints the table, or the wire result with --json", async () => {
  const table = harness();
  assert.equal(await runDataList(client(), false, table.deps), 0);
  assert.match(table.out.join(""), /^NAME/);
  const json = harness();
  assert.equal(await runDataList(client(), true, json.deps), 0);
  assert.deepEqual(JSON.parse(json.out.join("")), { sources: [GOLEM] });
});

test("describe asks for the source and table it was given", async () => {
  const asked: unknown[] = [];
  const run = harness();
  const fake = client({
    describeData: async (...args: unknown[]) => {
      asked.push(args);
      return { source: GOLEM, tables: [], sample: {} };
    },
  });
  assert.equal(await runDataDescribe(fake, "golem", "usage", false, run.deps), 0);
  assert.deepEqual(asked, [["golem", "usage"]]);
});

test("a query sends the SQL, the limit and a result id, and prints the table", async () => {
  const sent: DataQueryParams[] = [];
  const run = harness();
  const fake = client({
    queryData: async (params: DataQueryParams) => {
      sent.push(params);
      return SPEND;
    },
  });
  const code = await runDataQuery(fake, { kind: "query", source: "golem", sql: "select 1", limit: 7, format: "table" }, run.deps);
  assert.equal(code, 0);
  assert.deepEqual(sent, [{ source: "golem", sql: "select 1", limit: 7, result_id: "cli-fixed" }]);
  assert.match(run.out.join(""), /3 rows · 0\.12 s\n$/);
});

test("csv and json go to stdout with no footer, and a cut result is noted on stderr", async () => {
  const cut = { ...SPEND, total_rows: 99, truncated: true };
  const run = harness();
  const fake = client({ queryData: async () => cut });
  assert.equal(await runDataQuery(fake, { kind: "query", source: "golem", sql: "select 1", limit: null, format: "csv" }, run.deps), 0);
  assert.equal(run.out.join(""), `${formatQueryCsv(cut)}\n`);
  assert.deepEqual(run.err, ["first 3 of 99 rows"]);
});

test("the SQL comes from stdin when none is given, and a terminal with none is told", async () => {
  const sent: DataQueryParams[] = [];
  const fake = client({
    queryData: async (params: DataQueryParams) => {
      sent.push(params);
      return SPEND;
    },
  });
  const piped = harness({ stdin: "select 2\n" });
  assert.equal(await runDataQuery(fake, { kind: "query", source: "golem", sql: null, limit: null, format: "json" }, piped.deps), 0);
  assert.equal(sent[0]?.sql, "select 2");
  const tty = harness({ tty: true });
  assert.equal(await runDataQuery(fake, { kind: "query", source: "golem", sql: null, limit: null, format: "table" }, tty.deps), 1);
  assert.match(tty.err.join(""), /pipe it in on stdin/);
  const empty = harness({ stdin: "  \n" });
  assert.equal(await runDataQuery(fake, { kind: "query", source: "golem", sql: null, limit: null, format: "table" }, empty.deps), 1);
  assert.equal(sent.length, 1);
});

test("Ctrl-C sends data.cancel with the id the query was sent with, and exits 130", async () => {
  const cancelled: string[] = [];
  const sent: DataQueryParams[] = [];
  const run = harness();
  const fake = client({
    queryData: (params: DataQueryParams) => {
      sent.push(params);
      return new Promise<never>(() => undefined);
    },
    cancelData: async (id: string) => {
      cancelled.push(id);
      return {};
    },
  });
  const done = runDataQuery(fake, { kind: "query", source: "golem", sql: "select 1", limit: null, format: "table" }, run.deps);
  await new Promise((resolve) => setImmediate(resolve));
  run.interrupt();
  assert.equal(await done, 130);
  assert.deepEqual(cancelled, ["cli-fixed"]);
  assert.equal(sent[0]?.result_id, "cli-fixed");
  assert.deepEqual(run.err, ["Cancelled."]);
});

test("the daemon's sentence reaches the caller, and a daemon without the methods is told to update", async () => {
  const run = harness();
  const refused = client({
    queryData: async () => {
      throw new RpcError(-32000, "Only SELECT statements may run here.");
    },
  });
  await assert.rejects(runDataQuery(refused, { kind: "query", source: "golem", sql: "drop table x", limit: null, format: "table" }, run.deps), /Only SELECT statements/);
  const old = client({
    listData: async () => {
      throw new RpcError(-32601, "Method not found");
    },
    queryData: async () => {
      throw new RpcError(-32601, "Method not found");
    },
  });
  await assert.rejects(runDataList(old, false, run.deps), new RegExp(NO_DATA_METHODS));
  await assert.rejects(runDataQuery(old, { kind: "query", source: "golem", sql: "select 1", limit: null, format: "table" }, run.deps), new RegExp(NO_DATA_METHODS));
});

test("export and --out: the arguments", () => {
  assert.deepEqual(parseDataArgs(["export", "r1", "out.csv"]), { kind: "export", resultId: "r1", path: "out.csv", format: null });
  assert.deepEqual(parseDataArgs(["export", "r1", "out.txt", "--format", "json"]), { kind: "export", resultId: "r1", path: "out.txt", format: "json" });
  assert.deepEqual(parseDataArgs(["query", "golem", "select 1", "--out", "~/a.parquet"]), {
    kind: "query",
    source: "golem",
    sql: "select 1",
    limit: null,
    format: "table",
    out: "~/a.parquet",
  });
  assert.deepEqual(parseDataArgs(["export", "r1", "a.csv", "--format", "xml"]), { kind: "error", message: "--format is csv, parquet, json, xlsx" });
  assert.deepEqual(parseDataArgs(["query", "golem", "select 1", "--out"]), { kind: "error", message: "--out needs a file name" });
  assert.equal(parseDataArgs(["query", "golem", "select 1", "--out", "a.csv", "--format", "csv"]).kind, "error");
  for (const bad of [["export"], ["export", "r1"], ["export", "r1", "a", "b"], ["export", "r1", "a", "--wat"]]) {
    assert.equal(parseDataArgs(bad).kind, "error", bad.join(" "));
  }
  assert.match(DATA_HELP, /golem data export <result_id> <file>/);
});

test("export sends the id, a path made absolute here, and the format, and says how many rows it wrote", async () => {
  const asked: unknown[][] = [];
  const fake = client({
    exportDataResult: async (...args: unknown[]) => {
      asked.push(args);
      return { path: String(args[1]), rows: 9 };
    },
  });
  const run = harness();
  run.deps.cwd = () => "/work";
  assert.equal(await runDataExport(fake, { kind: "export", resultId: "r1", path: "out.csv", format: null }, run.deps), 0);
  assert.equal(await runDataExport(fake, { kind: "export", resultId: "r1", path: "~/a.json", format: "json" }, run.deps), 0);
  assert.deepEqual(asked, [
    ["r1", "/work/out.csv", undefined],
    ["r1", "~/a.json", "json"],
  ]);
  assert.deepEqual(run.out, ["Wrote 9 rows to /work/out.csv\n", "Wrote 9 rows to ~/a.json\n"]);
});

test("query --out runs the query, writes the file and prints no rows", async () => {
  const asked: unknown[][] = [];
  const fake = client({
    exportDataResult: async (...args: unknown[]) => {
      asked.push(args);
      return { path: "/tmp/a.csv", rows: 3 };
    },
  });
  const run = harness();
  assert.equal(await runDataQuery(fake, { kind: "query", source: "golem", sql: "select 1", limit: null, format: "table", out: "/tmp/a.csv" }, run.deps), 0);
  assert.deepEqual(asked, [["r1", "/tmp/a.csv", undefined]]);
  assert.deepEqual(run.out, ["Wrote 3 rows to /tmp/a.csv\n"]);
});

test("export says plainly when the Excel add-on is missing, and when the daemon is old", async () => {
  const missing = client({ exportDataResult: async () => ({ path: "", rows: 0, needs_extension: "excel" }) });
  const run = harness();
  assert.equal(await runDataExport(missing, { kind: "export", resultId: "r1", path: "/tmp/a.xlsx", format: null }, run.deps), 1);
  assert.match(run.err.join(""), /one-time download.*Nothing was written/);
  assert.deepEqual(run.out, []);
  const old = client({
    exportDataResult: async () => {
      throw new RpcError(-32601, "Method not found");
    },
  });
  await assert.rejects(runDataExport(old, { kind: "export", resultId: "r1", path: "/tmp/a.csv", format: null }, run.deps), new RegExp(NO_DATA_METHODS));
});

test("a printed query tells its result id on stderr", async () => {
  const run = harness();
  assert.equal(await runDataQuery(client(), { kind: "query", source: "golem", sql: "select 1", limit: null, format: "table" }, run.deps), 0);
  assert.match(run.err.join(""), /result r1: write it to a file with golem data export r1 <file>/);
});

test("notes prints the notes, or says how to write some", async () => {
  const seen = harness();
  const fake = client({ getDataNotes: async () => ({ text: "amount < 0 is money out\n", path: "/h/data/bank/DATA.md" }) });
  assert.equal(await runDataNotes(fake, "bank", false, seen.deps), 0);
  assert.equal(seen.out.join(""), "amount < 0 is money out\n");
  const none = harness();
  const empty = client({ getDataNotes: async () => ({ text: null, path: "/h/data/bank/DATA.md" }) });
  assert.equal(await runDataNotes(empty, "bank", false, none.deps), 0);
  assert.match(none.out.join(""), /No notes for bank\. Write some with: golem data notes bank --edit/);
});

test("notes --edit saves what the editor returns, and leaves an unchanged file alone", async () => {
  const saved: unknown[][] = [];
  const fake = client({
    getDataNotes: async () => ({ text: "old\n", path: "/h/data/bank/DATA.md" }),
    setDataNotes: async (...args: unknown[]) => {
      saved.push(args);
      return { path: "/h/data/bank/DATA.md" };
    },
  });
  const changed = harness();
  changed.deps.edit = async (text, name) => {
    assert.equal(name, "DATA.md");
    return `${text}new line\n`;
  };
  assert.equal(await runDataNotes(fake, "bank", true, changed.deps), 0);
  assert.deepEqual(saved, [["bank", "old\nnew line\n"]]);
  assert.match(changed.out.join(""), /Saved to \/h\/data\/bank\/DATA\.md/);
  const same = harness();
  same.deps.edit = async (text) => text;
  assert.equal(await runDataNotes(fake, "bank", true, same.deps), 0);
  assert.equal(saved.length, 1);
  const failed = harness();
  failed.deps.edit = async () => null;
  assert.equal(await runDataNotes(fake, "bank", true, failed.deps), 1);
  assert.match(failed.err.join(""), /nothing was saved/);
});

test("notes parses a source and --edit, and a daemon without the methods is told to update", async () => {
  assert.deepEqual(parseDataArgs(["notes", "bank"]), { kind: "notes", source: "bank", edit: false });
  assert.deepEqual(parseDataArgs(["notes", "--edit", "bank"]), { kind: "notes", source: "bank", edit: true });
  assert.equal(parseDataArgs(["notes"]).kind, "error");
  assert.equal(parseDataArgs(["notes", "a", "b"]).kind, "error");
  const old = client({
    getDataNotes: async () => {
      throw new RpcError(-32601, "Method not found");
    },
  });
  await assert.rejects(runDataNotes(old, "bank", false, harness().deps), new RegExp(NO_DATA_METHODS));
});

test("a daemon that is not running gets the usual message", () => {
  const text = explainDaemonDown("connect ECONNREFUSED /x.sock", null, false);
  assert.match(text, /daemon is not running/);
  assert.match(text, /run: golem daemon install/);
});

const SHOP = { name: "shop", kind: "postgres", scope: "user", location: "postgres://golem_ro@db.example.com:5432/shop", privacy: "schema", status: "ready", in_keychain: true } as const;

test("add parses the name, the address and the options", () => {
  assert.deepEqual(parseDataArgs(["add", "shop", "postgres://u@h/d"]), { kind: "add", name: "shop", location: "postgres://u@h/d", privacy: null, passwordStdin: false });
  assert.deepEqual(parseDataArgs(["add", "shop", "postgres://u@h/d", "--privacy", "open", "--password-stdin"]), { kind: "add", name: "shop", location: "postgres://u@h/d", privacy: "open", passwordStdin: true });
  assert.equal(parseDataArgs(["add", "shop"]).kind, "error");
  assert.equal(parseDataArgs(["add", "shop", "x", "--privacy", "all"]).kind, "error");
  assert.equal(parseDataArgs(["add", "shop", "x", "--nope"]).kind, "error");
});

test("add asks for the password without echo and sends it to the daemon, not in the address", async () => {
  const prompts: string[] = [];
  const run = harness({ tty: true, password: "s3cret", prompts });
  const sent: unknown[] = [];
  const fake = client({ addData: async (params: unknown) => (sent.push(params), { source: { ...SHOP, warning: "This login can change data. golem only reads, but a read-only login is safer." } }) });
  const code = await runDataAdd(fake, { kind: "add", name: "shop", location: SHOP.location, privacy: null, passwordStdin: false }, run.deps);
  assert.equal(code, 0);
  assert.deepEqual(prompts, ["Password for golem_ro@db.example.com (Enter for none): "]);
  assert.deepEqual(sent, [{ name: "shop", location: SHOP.location, privacy: "schema", scope: "user", password: "s3cret" }]);
  const printed = run.out.join("");
  assert.match(printed, /Added shop \(PostgreSQL, schema only\)\./);
  assert.match(printed, /Keychain as golem\/data\/shop/);
  assert.match(printed, /This login can change data/);
  assert.equal(printed.includes("s3cret") || run.err.join("").includes("s3cret"), false);
});

test("add reads the password from stdin with --password-stdin, and a database on this Mac is local", async () => {
  const run = harness({ stdin: "from-a-pipe\n" });
  const sent: unknown[] = [];
  const fake = client({ addData: async (params: unknown) => (sent.push(params), { source: { ...SHOP, privacy: "local" } }) });
  const code = await runDataAdd(fake, { kind: "add", name: "dev", location: "mysql://u@localhost/dev", privacy: null, passwordStdin: true }, run.deps);
  assert.equal(code, 0);
  assert.deepEqual(sent, [{ name: "dev", location: "mysql://u@localhost/dev", privacy: "local", scope: "user", password: "from-a-pipe" }]);
});

test("add refuses an address with a password in it, and never repeats it", async () => {
  const run = harness({ tty: true, password: "x" });
  const sent: unknown[] = [];
  const fake = client({ addData: async (params: unknown) => (sent.push(params), { source: SHOP }) });
  const code = await runDataAdd(fake, { kind: "add", name: "shop", location: "postgres://u:hunter2@h/d", privacy: null, passwordStdin: false }, run.deps);
  assert.equal(code, 1);
  assert.deepEqual(sent, []);
  assert.match(run.err.join(""), /has a password in it/);
  assert.equal(run.err.join("").includes("hunter2"), false);
});

test("add of a folder sends no password and says a folder has none when one is piped", async () => {
  const run = harness({ stdin: "x" });
  const sent: unknown[] = [];
  const fake = client({ addData: async (params: unknown) => (sent.push(params), { source: BANK }) });
  assert.equal(await runDataAdd(fake, { kind: "add", name: "bank", location: "~/bank/*.csv", privacy: "local", passwordStdin: false }, run.deps), 0);
  assert.deepEqual(sent, [{ name: "bank", location: "~/bank/*.csv", privacy: "local", scope: "user" }]);
  assert.equal(await runDataAdd(fake, { kind: "add", name: "bank", location: "~/bank", privacy: null, passwordStdin: true }, run.deps), 1);
  assert.match(run.err.join(""), /no password/);
});
