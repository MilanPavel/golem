import type { ToolTable } from "../../store/data.ts";

/** Kept results of `data_query` calls, for the gallery and the tests. */
export const SAMPLE_SUBSCRIPTIONS: ToolTable = {
  result_id: "r_7f2",
  source: "bank",
  columns: [
    { name: "name", type: "VARCHAR" },
    { name: "months", type: "INTEGER" },
    { name: "per_month", type: "DECIMAL(10,2)" },
    { name: "total", type: "DECIMAL(10,2)" },
    { name: "last_charge", type: "DATE" },
  ],
  rows: [
    ["Adobe CC", 12, 57.99, 693, "2026-11-02"],
    ["Fit24 gym", 11, 29, 319, "2026-11-05"],
    ["Netflix", 10, 13.99, 139.9, "2026-11-11"],
    ["Spotify", 10, 11.99, 119.9, "2026-11-08"],
    ["iCloud 200 GB", 10, 2.99, 29.9, "2026-11-14"],
    ["Headspace", 3, 12.99, 38.97, "2026-09-12"],
    ["NYT digital", 7, 4, 28, "2026-07-21"],
    ["Notes app, a plan with a very long name that does not fit on one line of the table at all, so it is cut", 4, null, null, "2026-10-30"],
    ["Gym towel service", 2, 5, 10, "2026-08-02"],
  ],
  total_rows: 9,
  truncated: false,
};

type Row = (string | number | null)[];

function paymentRows(offset: number, count: number): Row[] {
  return Array.from({ length: count }, (_, at) => {
    const n = offset + at;
    return [n + 1, `payee ${n + 1}`, n % 7 === 0 ? null : Math.round((n * 373.1) % 9000) / 10, 2000 + (n % 26)];
  });
}

export const SAMPLE_BIG_RESULT: ToolTable = {
  result_id: "r_a91",
  source: "bank",
  columns: [
    { name: "id", type: "BIGINT" },
    { name: "payee", type: "VARCHAR" },
    { name: "amount", type: "DECIMAL(10,2)" },
    { name: "year", type: "INTEGER" },
  ],
  rows: paymentRows(0, 50),
  total_rows: 18302,
  truncated: false,
};

/** The second page of `SAMPLE_BIG_RESULT`. */
export const SAMPLE_BIG_PAGE_TWO = { offset: 50, rows: paymentRows(50, 50), total: 18302 };

export const SAMPLE_SPEND_BY_NAME: ToolTable = {
  result_id: "r_b03",
  source: "bank",
  columns: [
    { name: "name", type: "VARCHAR" },
    { name: "total", type: "DECIMAL(10,2)" },
  ],
  rows: SAMPLE_SUBSCRIPTIONS.rows.slice(0, 7).map((row) => [row[0] ?? null, row[3] ?? null]),
  total_rows: 7,
  truncated: false,
};

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];

export const SAMPLE_SPEND_BY_MONTH: ToolTable = {
  result_id: "r_c17",
  source: "bank",
  columns: [
    { name: "month", type: "DATE" },
    { name: "spent", type: "DECIMAL(10,2)" },
    { name: "earned", type: "DECIMAL(10,2)" },
  ],
  rows: MONTHS.map((month, at) => [`${month}-01`, 1200 + ((at * 211) % 530), 2400 + ((at * 97) % 300)]),
  total_rows: MONTHS.length,
  truncated: false,
};

export const SAMPLE_TRUNCATED_RESULT: ToolTable = { ...SAMPLE_BIG_RESULT, result_id: "r_d44", total_rows: 1000, truncated: true };

export const SAMPLE_EMPTY_RESULT: ToolTable = {
  result_id: "r_e55",
  source: "bank",
  columns: [
    { name: "name", type: "VARCHAR" },
    { name: "total", type: "DECIMAL(10,2)" },
  ],
  rows: [],
  total_rows: 0,
  truncated: false,
};
