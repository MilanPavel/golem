// `golem data`: list the data sources, describe one, and run a query on it.

export const DATA_FORMATS = ["table", "csv", "json"] as const;
export type DataFormat = (typeof DATA_FORMATS)[number];

export const DATA_USAGE =
  "usage: golem data [list] [--json] | golem data describe <source> [<table>] [--json] | golem data query <source> [<sql> | -] [--limit N] [--format table|csv|json]";

/** The text of `golem data --help` and `golem help data`. */
export const DATA_HELP = [
  "golem data: look at the data golem can read, and ask it questions with SQL.",
  "",
  "  golem data [list] [--json]",
  "      One line per source: name, kind, scope, tables, rows, privacy and status.",
  "  golem data describe <source> [<table>] [--json]",
  "      The tables of a source with their columns and stats, its notes, and a few sample rows.",
  "  golem data query <source> <sql> [--limit N] [--format table|csv|json]",
  "      Runs the SQL and prints the rows. Give the SQL as a word, or on stdin with - or no word:",
  '        golem data query golem "select model, sum(cost_usd) from usage group by model"',
  "        echo 'select 1' | golem data query golem -",
  "      --limit N      at most N rows",
  "      --format       table (the default, with a count and the time), csv or json (only the rows, for scripts)",
  "",
  "Ctrl-C stops a running query and exits with 130. An error from golem goes to stderr and the exit code is 1.",
].join("\n");

export type DataArgs =
  | { kind: "list"; json: boolean }
  | { kind: "describe"; source: string; table: string | null; json: boolean }
  /** `sql` is null when it comes from stdin. */
  | { kind: "query"; source: string; sql: string | null; limit: number | null; format: DataFormat }
  | { kind: "help" }
  | { kind: "error"; message: string };

function fail(message: string): DataArgs {
  return { kind: "error", message };
}

/** Parse the words after `golem data`. */
export function parseDataArgs(args: readonly string[]): DataArgs {
  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  const [first, ...rest] = args;
  if (first === undefined || first === "list" || first === "--json") {
    const words = first === "list" || first === undefined ? rest : args;
    return words.every((word) => word === "--json") && words.length <= 1 ? { kind: "list", json: words.length === 1 } : fail(DATA_USAGE);
  }
  if (first === "describe") return parseDescribe(rest);
  if (first === "query") return parseQuery(rest);
  return fail(DATA_USAGE);
}

function parseDescribe(args: readonly string[]): DataArgs {
  const json = args.includes("--json");
  const words = args.filter((word) => word !== "--json");
  const [source, table, ...extra] = words;
  if (source === undefined || source.startsWith("-") || (table !== undefined && table.startsWith("-")) || extra.length > 0) {
    return fail("usage: golem data describe <source> [<table>] [--json]");
  }
  return { kind: "describe", source, table: table ?? null, json };
}

function parseQuery(args: readonly string[]): DataArgs {
  const usage = "usage: golem data query <source> [<sql> | -] [--limit N] [--format table|csv|json]";
  const words: string[] = [];
  let limit: number | null = null;
  let format: DataFormat = "table";
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? "";
    if (word === "--limit" || word === "--format") {
      const value = args[index + 1];
      if (value === undefined || value.length === 0) return fail(`${word} needs a value`);
      index += 1;
      if (word === "--limit") {
        const count = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(count) || count < 1) return fail("--limit is a whole number, 1 or more");
        limit = count;
      } else {
        const known = DATA_FORMATS.find((each) => each === value);
        if (known === undefined) return fail(`--format is ${DATA_FORMATS.join(", ")}`);
        format = known;
      }
    } else if (word === "-" || !word.startsWith("-")) {
      words.push(word);
    } else {
      return fail(`unknown option ${word}\n${usage}`);
    }
  }
  const [source, sql, ...extra] = words;
  if (source === undefined || source === "-" || extra.length > 0) return fail(usage);
  if (sql !== undefined && sql !== "-" && sql.trim().length === 0) return fail("the SQL is empty");
  return { kind: "query", source, sql: sql === undefined || sql === "-" ? null : sql, limit, format };
}
