import type { DataDescribeResult, DataInspectResult, DataListResult, DataSource } from "../../store/data.ts";

/** Sources for the gallery and the tests. */
export const SAMPLE_FOLDER = "/Users/you/work/shop-api";

export const SAMPLE_BANK: DataSource = {
  name: "bank",
  kind: "files",
  scope: "user",
  location: "~/Documents/bank/*.csv",
  privacy: "local",
  status: "ready",
  tables: 1,
  rows: 18302,
  watch: true,
};

export const SAMPLE_SHOP_DEV: DataSource = {
  name: "shop_dev",
  kind: "postgres",
  scope: "project",
  project: SAMPLE_FOLDER,
  location: "postgres://golem_ro@localhost:5432/shop_dev",
  privacy: "open",
  status: "ready",
  tables: 3,
  rows: 27117,
};

export const SAMPLE_SHOP_PROD: DataSource = {
  name: "shop_prod",
  kind: "postgres",
  scope: "project",
  project: SAMPLE_FOLDER,
  location: "postgres://golem_ro@db.internal:5432/shop",
  privacy: "schema",
  status: "ready",
  tables: 2,
};

export const SAMPLE_LOGS: DataSource = {
  name: "logs",
  kind: "files",
  scope: "project",
  project: SAMPLE_FOLDER,
  location: "./var/log/*.jsonl",
  privacy: "open",
  status: "untrusted",
};

export const SAMPLE_READING: DataSource = {
  name: "receipts",
  kind: "files",
  scope: "user",
  location: "~/Documents/receipts/*.xlsx",
  privacy: "local",
  status: "reading",
};

export const SAMPLE_BROKEN: DataSource = {
  name: "archive",
  kind: "sqlite",
  scope: "user",
  location: "~/old/archive.db",
  privacy: "local",
  status: "error",
  error: "No such file: ~/old/archive.db",
};

export const SAMPLE_BUILTIN: DataSource = {
  name: "golem",
  kind: "builtin",
  scope: "builtin",
  location: "~/.golem/golem.db (read-only)",
  privacy: "open",
  status: "ready",
  tables: 2,
  rows: 1552,
};

export const SAMPLE_DATA_LIST: DataListResult = {
  sources: [SAMPLE_SHOP_DEV, SAMPLE_SHOP_PROD, SAMPLE_LOGS, SAMPLE_BANK, SAMPLE_READING, SAMPLE_BROKEN, SAMPLE_BUILTIN],
};

export const SAMPLE_BANK_DESCRIBED: DataDescribeResult = {
  source: SAMPLE_BANK,
  tables: [
    {
      name: "transactions",
      rows: 18302,
      columns: [
        { name: "date", type: "DATE", min: "2024-01-02", max: "2026-11-24" },
        { name: "description", type: "VARCHAR", distinct: 6120 },
        { name: "amount", type: "DECIMAL(10,2)", min: "-2450.00", max: "4120.00" },
        { name: "account", type: "VARCHAR", distinct: 2 },
      ],
    },
    {
      name: "accounts",
      rows: 2,
      columns: [
        { name: "id", type: "INT", distinct: 2 },
        { name: "name", type: "VARCHAR", distinct: 2 },
      ],
    },
  ],
  sample: {
    transactions: [
      ["2026-11-24", "SPOTIFY P1A2", -10.99, "checking"],
      ["2026-11-23", "LIDL 214", -34.2, "checking"],
      ["2026-11-22", "NETFLIX.COM", -13.99, "checking"],
      ["2026-11-21", "SALARY ACME SRO", 4120, "checking"],
    ],
    accounts: [
      [1, "checking"],
      [2, "savings"],
    ],
  },
  notes: "# bank\n\nMy bank's CSV exports, one file a month.\n",
  queries: [
    { name: "subscriptions this year", description: "rows that repeat monthly with the same amount", sql: "SELECT description, count(*) AS months\nFROM transactions\nWHERE amount < 0\nGROUP BY description\nHAVING months >= 3", last_run_at: "2026-11-25T09:10:00+00:00" },
    { name: "spending by month", sql: "SELECT month(date) AS month, -sum(amount) AS spent\nFROM transactions\nWHERE amount < 0\nGROUP BY month", last_run_at: null },
  ],
};

export const SAMPLE_PROD_DESCRIBED: DataDescribeResult = {
  source: SAMPLE_SHOP_PROD,
  tables: [
    {
      name: "users",
      rows: null,
      columns: [
        { name: "id", type: "BIGINT" },
        { name: "email", type: "TEXT" },
        { name: "plan_id", type: "INT" },
      ],
    },
    {
      name: "orders",
      rows: null,
      columns: [
        { name: "id", type: "BIGINT" },
        { name: "user_id", type: "BIGINT" },
        { name: "total", type: "NUMERIC(10,2)" },
      ],
    },
  ],
  sample: {},
  notes: null,
  queries: [],
};

export const SAMPLE_DEV_DESCRIBED: DataDescribeResult = {
  source: SAMPLE_SHOP_DEV,
  tables: [
    {
      name: "users",
      rows: 4210,
      columns: [
        { name: "id", type: "BIGINT" },
        { name: "email", type: "TEXT", distinct: 4210 },
        { name: "plan_id", type: "INT" },
        { name: "last_login_at", type: "TIMESTAMPTZ", null_fraction: 0.12 },
      ],
    },
  ],
  sample: { users: [[4210, "dev+4210@example.test", 2, "2026-11-24 18:02"], [4209, "dev+4209@example.test", 1, "2026-11-24 11:40"]] },
  notes: null,
  queries: [],
};

export const SAMPLE_BUILTIN_DESCRIBED: DataDescribeResult = {
  source: SAMPLE_BUILTIN,
  tables: [
    {
      name: "usage",
      rows: 1240,
      columns: [
        { name: "day", type: "DATE" },
        { name: "model", type: "VARCHAR", distinct: 11 },
        { name: "tokens_in", type: "BIGINT" },
      ],
    },
  ],
  sample: { usage: [["2026-11-25", "claude-sonnet-5-5", 182004]] },
  notes: null,
  queries: [{ name: "cost by model this month", sql: "SELECT model, sum(cost_usd) FROM usage GROUP BY model", last_run_at: null }],
};

/** What a check of a folder of CSV files found. */
export const SAMPLE_INSPECT_FILES: DataInspectResult = {
  kind: "files",
  files: 36,
  tables: [
    {
      name: "transactions",
      rows: 18302,
      columns: [
        { name: "date", type: "DATE" },
        { name: "description", type: "VARCHAR" },
        { name: "amount", type: "DECIMAL(10,2)" },
        { name: "account", type: "VARCHAR" },
      ],
    },
  ],
  sample: {
    transactions: [
      ["2026-11-24", "SPOTIFY P1A2", -10.99, "checking"],
      ["2026-11-23", "LIDL 214", -34.2, "checking"],
      ["2026-11-22", "NETFLIX.COM", -13.99, "checking"],
    ],
  },
  suggested_name: "bank",
  suggested_privacy: "local",
  privacy_reason: "The files are in your home folder and the columns look like money.",
  notes: ["amount is money: negative looks like money out", "delimiter is a semicolon, decimals use a comma"],
};

/** What a test of a database found. */
export const SAMPLE_INSPECT_PG: DataInspectResult = {
  kind: "postgres",
  tables: [
    { name: "users", rows: 4210, columns: [{ name: "id", type: "BIGINT" }, { name: "email", type: "TEXT" }] },
    { name: "orders", rows: 22904, columns: [{ name: "id", type: "BIGINT" }, { name: "total", type: "NUMERIC(10,2)" }] },
    { name: "plans", rows: 3, columns: [{ name: "id", type: "INT" }] },
  ],
  sample: { users: [[4210, "dev+4210@example.test"], [4209, "dev+4209@example.test"]] },
  suggested_name: "shop_dev",
  suggested_privacy: "open",
  privacy_reason: "The database is on localhost and the emails look like seed data.",
  notes: [],
};
