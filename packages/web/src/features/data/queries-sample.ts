import type { DataSavedQuery, ToolTable } from "../../store/data.ts";

/** Saved queries of the bank source, for the gallery and the tests. The times are told against SAMPLE_NOW. */
export const SAMPLE_NOW = new Date(2026, 10, 27, 12, 0);

export const SAMPLE_QUERIES: readonly DataSavedQuery[] = [
  {
    name: "Spending by month",
    description: "Money out per month this year, card and transfers, refunds left out",
    sql: "select strftime(booked, '%Y-%m') as month, round(sum(-amount), 2) as spent, count(*) as payments\nfrom transactions\nwhere amount < 0 and year(booked) = year(current_date)\ngroup by 1 order by 1",
    last_run_at: new Date(2026, 10, 27, 9, 14).toISOString(),
    last_rows: 11,
    last_ms: 38,
  },
  {
    name: "Subscriptions",
    description: "Charges that repeat every month, with this year's total",
    sql: "with monthly as (select description, strftime(booked, '%Y-%m') m, -amount a from transactions where amount < 0)\nselect description, count(*) as months, sum(a) as total from monthly group by 1 having months >= 3",
    last_run_at: new Date(2026, 10, 24, 10, 2).toISOString(),
    last_rows: 9,
    last_ms: 51,
  },
  {
    name: "Big payments this week",
    description: "Any single payment over 500 in the last 7 days",
    sql: "select booked, description, -amount as paid from transactions where amout < -500 and booked >= current_date - 7",
    last_run_at: new Date(2026, 10, 27, 11, 0).toISOString(),
    last_error: 'Binder Error: Referenced column "amout" not found in FROM clause!\nCandidate bindings: "amount"',
  },
];

/** The result that opens under the first query after Run. */
export const SAMPLE_QUERY_RESULT: ToolTable = {
  result_id: "res_q1",
  source: "bank",
  columns: [
    { name: "month", type: "VARCHAR" },
    { name: "spent", type: "DECIMAL(10,2)" },
    { name: "payments", type: "BIGINT" },
  ],
  rows: [
    ["2026-09", 2090.4, 58],
    ["2026-10", 2611.05, 73],
    ["2026-11", 1488.9, 41],
  ],
  total_rows: 11,
  truncated: false,
};

/** A chat result of `data_query`, with the SQL that made it. */
export const SAMPLE_SAVABLE_RESULT: ToolTable = {
  ...SAMPLE_QUERY_RESULT,
  result_id: "res_q2",
  sql: SAMPLE_QUERIES[0]?.sql ?? "",
};

export const SAMPLE_TRIED_ROWS = {
  kind: "rows" as const,
  columns: [
    { name: "booked", type: "DATE" },
    { name: "description", type: "VARCHAR" },
    { name: "paid", type: "DECIMAL(10,2)" },
  ],
  rows: [
    ["2026-11-24", "IKEA PRAHA", 812],
    ["2026-11-22", "LETENKY.CZ", 645.3],
  ],
  total: 2,
  ms: 31,
};
