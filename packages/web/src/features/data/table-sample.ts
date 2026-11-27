import type { ViewCell } from "@golem/view";
import type { DataColumnProfile, DataProfileResult, DataSource, DataTable } from "../../store/data.ts";

/** A made-up passenger list, like titanic.csv, for the gallery and the tests. The same numbers every time. */

let seed = 7;
const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)] as T;

const LAST = ["Braund", "Cumings", "Heikkinen", "Futrelle", "Allen", "Moran", "McCarthy", "Palsson", "Johnson", "Nasser", "Sandstrom", "Bonnell", "Andersson", "Hewlett", "Rice", "Williams", "Fynney", "Beesley", "Sloper", "Asplund"];
const FIRST_M = ["Owen Harris", "William Henry", "James", "Timothy J", "Gosta Leonard", "Charles Eugene", "Lawrence", "Harry"];
const FIRST_F = ["Laina", "Elisabeth", "Anna", "Margaret", "Hulda", "Augusta", "Mary", "Florence Briggs"];

export const PASSENGER_COLUMNS = [
  { name: "PassengerId", type: "BIGINT" },
  { name: "Survived", type: "BIGINT" },
  { name: "Pclass", type: "BIGINT" },
  { name: "Name", type: "VARCHAR" },
  { name: "Sex", type: "VARCHAR" },
  { name: "Age", type: "DOUBLE" },
  { name: "SibSp", type: "BIGINT" },
  { name: "Parch", type: "BIGINT" },
  { name: "Ticket", type: "VARCHAR" },
  { name: "Fare", type: "DOUBLE" },
  { name: "Cabin", type: "VARCHAR" },
  { name: "Embarked", type: "VARCHAR" },
] as const;

export const PASSENGERS: ViewCell[][] = Array.from({ length: 891 }, (_, at) => {
  const female = rnd() < 0.35;
  const pclass = rnd() < 0.24 ? 1 : rnd() < 0.27 ? 2 : 3;
  const survived = rnd() < (female ? 0.74 : 0.19) ? 1 : 0;
  const age = rnd() < 0.2 ? null : Math.max(0.42, Math.round((pclass === 1 ? 38 : pclass === 2 ? 30 : 25) + (rnd() + rnd() + rnd() - 1.5) * 22));
  const fare = Math.round((pclass === 1 ? 30 + rnd() * rnd() * 480 : pclass === 2 ? 10 + rnd() * 30 : 7 + rnd() * rnd() * 40) * 100) / 100;
  const name = `${pick(LAST)}, ${female ? (rnd() < 0.6 ? "Mrs." : "Miss.") : "Mr."} ${female ? pick(FIRST_F) : pick(FIRST_M)}`;
  const sibsp = rnd() < 0.68 ? 0 : rnd() < 0.75 ? 1 : Math.ceil(rnd() * 8);
  const parch = rnd() < 0.76 ? 0 : Math.ceil(rnd() * 6);
  const ticket = rnd() < 0.3 ? `PC ${17000 + Math.floor(rnd() * 900)}` : String(100000 + Math.floor(rnd() * 300000));
  const cabin = pclass === 1 && rnd() < 0.8 ? `${pick(["A", "B", "C", "D", "E"])}${Math.ceil(rnd() * 120)}` : rnd() < 0.05 ? `F${Math.ceil(rnd() * 40)}` : null;
  const embarked = rnd() < 0.72 ? "S" : rnd() < 0.68 ? "C" : rnd() < 0.99 ? "Q" : null;
  return [at + 1, survived, pclass, name, female ? "female" : "male", age, sibsp, parch, ticket, fare, cabin, embarked];
});

const BINS = 24;

function profileOf(at: number): DataColumnProfile {
  const { name, type } = PASSENGER_COLUMNS[at] as { name: string; type: string };
  const values = PASSENGERS.map((row) => row[at] as ViewCell);
  const present = values.filter((value) => value !== null);
  const counts = new Map<ViewCell, number>();
  for (const value of present) counts.set(value, (counts.get(value) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const base = { name, type, empty: Math.round((1 - present.length / values.length) * 1e6) / 1e6, distinct: counts.size };
  const numbers = present.filter((value): value is number => typeof value === "number");
  if (counts.size === values.length) return { ...base, shape: "key", min: Math.min(...numbers), max: Math.max(...numbers) };
  if (counts.size <= 12) {
    const shown = top.slice(0, 4);
    return {
      ...base,
      shape: "category",
      top: shown.map(([value, count]) => ({ value, count })),
      more_values: Math.max(0, counts.size - 4),
      more_rows: top.slice(4).reduce((sum, [, count]) => sum + count, 0),
    };
  }
  if (type === "DOUBLE") {
    const low = Math.min(...numbers);
    const high = Math.max(...numbers);
    const bins = new Array<number>(BINS).fill(0);
    for (const value of numbers) {
      const slot = Math.min(BINS - 1, Math.floor(((value - low) / (high - low || 1)) * BINS));
      bins[slot] = (bins[slot] ?? 0) + 1;
    }
    return { ...base, shape: "number", min: low, max: high, mean: numbers.reduce((sum, value) => sum + value, 0) / numbers.length, bins };
  }
  const lengths = present.map((value) => String(value).length);
  const lead = top[0];
  return {
    ...base,
    shape: "text",
    unique_ratio: counts.size / present.length,
    avg_length: lengths.reduce((sum, length) => sum + length, 0) / lengths.length,
    ...(lead !== undefined && lead[1] > 1 ? { most_common: { value: lead[0], count: lead[1] } } : {}),
  };
}

export const SAMPLE_PASSENGER_PROFILE: DataProfileResult = {
  source: "titanic",
  table: "titanic",
  rows: PASSENGERS.length,
  columns: PASSENGER_COLUMNS.map((_, at) => profileOf(at)),
};

export const SAMPLE_TITANIC: DataSource = {
  name: "titanic",
  kind: "files",
  scope: "user",
  location: "~/Downloads/titanic.csv",
  privacy: "local",
  status: "ready",
  tables: 1,
  rows: PASSENGERS.length,
};

export const SAMPLE_TITANIC_TABLE: DataTable = {
  name: "titanic",
  rows: PASSENGERS.length,
  columns: [
    { name: "file", type: "VARCHAR", min: "/Users/you/Downloads/titanic.csv", max: "/Users/you/Downloads/titanic.csv", distinct: 1 },
    ...SAMPLE_PASSENGER_PROFILE.columns.map((column) => ({ name: column.name, type: column.type, distinct: column.distinct, null_fraction: column.empty })),
  ],
};

/** The rows of the view the browser shows: filtered, then sorted, as the daemon would answer. */
export function passengerRows(view: { sex?: string; sortBy?: number; desc?: boolean }): ViewCell[][] {
  let rows = PASSENGERS.filter((row) => view.sex === undefined || row[4] === view.sex);
  const by = view.sortBy;
  if (by !== undefined) {
    const sign = view.desc === true ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = a[by] ?? null;
      const y = b[by] ?? null;
      if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0);
      return x < y ? -sign : x > y ? sign : 0;
    });
  }
  return rows;
}

/** A profile for a table that only has its description: every column as text, with what the description knows. For stories that are not about the charts. */
export function profileOfTable(source: string, table: DataTable | undefined): DataProfileResult {
  if (table === undefined) return { source, table: "", rows: 0, columns: [] };
  if (source === SAMPLE_TITANIC.name) return SAMPLE_PASSENGER_PROFILE;
  const rows = table.rows ?? 0;
  return {
    source,
    table: table.name,
    rows,
    columns: (table.columns ?? []).map((column) => ({
      name: column.name,
      type: column.type,
      shape: "text" as const,
      empty: column.null_fraction ?? 0,
      distinct: column.distinct ?? 0,
      unique_ratio: rows > 0 && column.distinct !== undefined && column.distinct !== null ? Math.min(1, column.distinct / rows) : 0,
    })),
  };
}
