// `golem data`: list the data sources, describe one, run a query on it, and write a result to a file.

export const DATA_FORMATS = ["table", "csv", "json"] as const;
export type DataFormat = (typeof DATA_FORMATS)[number];

export const EXPORT_FORMATS = ["csv", "parquet", "json", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const DATA_USAGE =
  "usage: golem data [list] [--json] | golem data add <name> <location> [--privacy open|local|schema] [--password-stdin] | golem data describe <source> [<table>] [--json] | golem data notes <source> [--edit] | golem data query <source> [<sql> | -] [--limit N] [--format table|csv|json] [--out <file>] | golem data export <result_id> <file> [--format csv|parquet|json|xlsx] | golem data query list|run|save|remove <source> ...";

/** The text of `golem data --help` and `golem help data`. */
export const DATA_HELP = [
  "golem data: look at the data golem can read, and ask it questions with SQL.",
  "",
  "  golem data [list] [--json]",
  "      One line per source: name, kind, scope, tables, rows, privacy and status.",
  "  golem data add <name> <location> [--privacy open|local|schema] [--password-stdin]",
  "      Adds a source for you. <location> is a file, a folder or a pattern, or a database address such as",
  "        postgres://golem_ro@localhost:5432/shop_dev   or   mysql://golem_ro@db.example.com/shop",
  "      A database address has no password in it. golem asks for the password without showing it, or reads it",
  "      from stdin with --password-stdin, and keeps it in the macOS Keychain, never in a file.",
  "      --privacy      who may see rows. The default is local for a database on this Mac, schema for any other.",
  "  golem data describe <source> [<table>] [--json]",
  "      The tables of a source with their columns and stats, its notes, and a few sample rows.",
  "  golem data notes <source> [--edit]",
  "      The notes of a source, which the model reads before it writes SQL. With --edit, opens them in $EDITOR and saves them.",
  "  golem data query <source> <sql> [--limit N] [--format table|csv|json]",
  "      Runs the SQL and prints the rows. Give the SQL as a word, or on stdin with - or no word:",
  '        golem data query golem "select model, sum(cost_usd) from usage group by model"',
  "        echo 'select 1' | golem data query golem -",
  "      --limit N      at most N rows",
  "      --format       table (the default, with a count and the time), csv or json (only the rows, for scripts)",
  "      --out FILE     write the whole result to a new file instead of printing it (.csv, .parquet, .json, .jsonl or .xlsx)",
  "  golem data query list <source> [--json]",
  "      The queries saved with a source: name, what it answers, and when it last ran.",
  "  golem data query run <source> <name> [--limit N] [--format table|csv|json] [--out <file>]",
  "      Runs a saved query by name, with no model.",
  "  golem data query save <source> <name> --sql <sql> [--description <text>] [--replace]",
  "      Saves a query with its source. Only queries that read can be saved. A name that is taken asks for --replace.",
  "  golem data query remove <source> <name>",
  "      Deletes a saved query. The source stays as it is.",
  "  golem data export <result_id> <file> [--format csv|parquet|json|xlsx]",
  "      Writes a result of an earlier query to a new file. A query prints its result id on stderr.",
  "      The format follows the end of the file name unless --format says. golem never overwrites a file,",
  "      and never writes into a data source.",
  "",
  "Ctrl-C stops a running query and exits with 130. An error from golem goes to stderr and the exit code is 1.",
].join("\n");

export type DataArgs =
  | { kind: "list"; json: boolean }
  | { kind: "describe"; source: string; table: string | null; json: boolean }
  | { kind: "notes"; source: string; edit: boolean }
  | { kind: "add"; name: string; location: string; privacy: "open" | "local" | "schema" | null; passwordStdin: boolean }
  /** `sql` is null when it comes from stdin. */
  | { kind: "query"; source: string; sql: string | null; limit: number | null; format: DataFormat; out?: string }
  | { kind: "queries-list"; source: string; json: boolean }
  | { kind: "queries-run"; source: string; name: string; limit: number | null; format: DataFormat; out?: string }
  | { kind: "queries-save"; source: string; name: string; sql: string; description: string | null; replace: boolean }
  | { kind: "queries-remove"; source: string; name: string }
  | { kind: "export"; resultId: string; path: string; format: ExportFormat | null }
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
  if (first === "notes") return parseNotes(rest);
  if (first === "add") return parseAdd(rest);
  if (first === "query") return parseSavedQuery(rest) ?? parseQuery(rest);
  if (first === "export") return parseExport(rest);
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

const PRIVACIES = ["open", "local", "schema"] as const;

function parseAdd(args: readonly string[]): DataArgs {
  const usage = "usage: golem data add <name> <location> [--privacy open|local|schema] [--password-stdin]";
  const words: string[] = [];
  let privacy: "open" | "local" | "schema" | null = null;
  let passwordStdin = false;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? "";
    if (word === "--password-stdin") {
      passwordStdin = true;
    } else if (word === "--privacy") {
      const value = args[index + 1];
      index += 1;
      const known = PRIVACIES.find((each) => each === value);
      if (known === undefined) return fail(`--privacy is ${PRIVACIES.join(", ")}`);
      privacy = known;
    } else if (word.startsWith("-")) {
      return fail(`unknown option ${word}\n${usage}`);
    } else {
      words.push(word);
    }
  }
  const [name, location, ...extra] = words;
  if (name === undefined || location === undefined || extra.length > 0) return fail(usage);
  return { kind: "add", name, location, privacy, passwordStdin };
}

function parseNotes(args: readonly string[]): DataArgs {
  const edit = args.includes("--edit");
  const words = args.filter((word) => word !== "--edit");
  const [source, ...extra] = words;
  if (source === undefined || source.startsWith("-") || extra.length > 0) return fail("usage: golem data notes <source> [--edit]");
  return { kind: "notes", source, edit };
}

function parseExport(args: readonly string[]): DataArgs {
  const usage = "usage: golem data export <result_id> <file> [--format csv|parquet|json|xlsx]";
  const words: string[] = [];
  let format: ExportFormat | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? "";
    if (word === "--format") {
      const value = args[index + 1];
      if (value === undefined || value.length === 0) return fail("--format needs a value");
      index += 1;
      const known = EXPORT_FORMATS.find((each) => each === value);
      if (known === undefined) return fail(`--format is ${EXPORT_FORMATS.join(", ")}`);
      format = known;
    } else if (!word.startsWith("-")) {
      words.push(word);
    } else {
      return fail(`unknown option ${word}\n${usage}`);
    }
  }
  const [resultId, path, ...extra] = words;
  if (resultId === undefined || path === undefined || extra.length > 0) return fail(usage);
  return { kind: "export", resultId, path, format };
}

function parseQuery(args: readonly string[]): DataArgs {
  const usage = "usage: golem data query <source> [<sql> | -] [--limit N] [--format table|csv|json] [--out <file>]";
  const words: string[] = [];
  let limit: number | null = null;
  let format: DataFormat | null = null;
  let out: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? "";
    if (word === "--out") {
      const value = args[index + 1];
      if (value === undefined || value.length === 0) return fail("--out needs a file name");
      index += 1;
      out = value;
    } else if (word === "--limit" || word === "--format") {
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
  if (out !== undefined && format !== null) return fail("--out writes a file whose format follows its name, so it does not take --format");
  return { kind: "query", source, sql: sql === undefined || sql === "-" ? null : sql, limit, format: format ?? "table", ...(out === undefined ? {} : { out }) };
}

const SAVED_WORDS = ["list", "run", "save", "remove"] as const;

/** `golem data query list|run|save|remove ...`, or null when the words are an ordinary query. */
function parseSavedQuery(args: readonly string[]): DataArgs | null {
  const [word, ...rest] = args;
  const verb = SAVED_WORDS.find((each) => each === word);
  if (verb === undefined) return null;
  const usage = {
    list: "usage: golem data query list <source> [--json]",
    run: "usage: golem data query run <source> <name> [--limit N] [--format table|csv|json] [--out <file>]",
    save: "usage: golem data query save <source> <name> --sql <sql> [--description <text>] [--replace]",
    remove: "usage: golem data query remove <source> <name>",
  }[verb];
  const words: string[] = [];
  const flags = new Map<string, string | true>();
  const withValue = verb === "save" ? ["--sql", "--description"] : verb === "run" ? ["--limit", "--format", "--out"] : [];
  const bare = verb === "save" ? ["--replace"] : verb === "list" ? ["--json"] : [];
  for (let index = 0; index < rest.length; index += 1) {
    const each = rest[index] ?? "";
    if (withValue.includes(each)) {
      const value = rest[index + 1];
      if (value === undefined || value.length === 0) return fail(`${each} needs a value`);
      flags.set(each, value);
      index += 1;
    } else if (bare.includes(each)) {
      flags.set(each, true);
    } else if (each.startsWith("-")) {
      return fail(`unknown option ${each}\n${usage}`);
    } else {
      words.push(each);
    }
  }
  const [source, name, ...extra] = words;
  if (source === undefined || extra.length > 0) return fail(usage);
  if (verb === "list") return name === undefined ? { kind: "queries-list", source, json: flags.has("--json") } : fail(usage);
  if (name === undefined) return fail(usage);
  if (verb === "remove") return { kind: "queries-remove", source, name };
  if (verb === "save") {
    const sql = flags.get("--sql");
    if (typeof sql !== "string" || sql.trim().length === 0) return fail(`save needs --sql\n${usage}`);
    const description = flags.get("--description");
    return { kind: "queries-save", source, name, sql, description: typeof description === "string" ? description : null, replace: flags.has("--replace") };
  }
  const limitText = flags.get("--limit");
  const formatText = flags.get("--format");
  const out = flags.get("--out");
  let limit: number | null = null;
  if (typeof limitText === "string") {
    const count = Number(limitText);
    if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(count) || count < 1) return fail("--limit is a whole number, 1 or more");
    limit = count;
  }
  const format = typeof formatText === "string" ? DATA_FORMATS.find((each) => each === formatText) : "table";
  if (format === undefined) return fail(`--format is ${DATA_FORMATS.join(", ")}`);
  if (typeof out === "string" && typeof formatText === "string") return fail("--out writes a file whose format follows its name, so it does not take --format");
  return { kind: "queries-run", source, name, limit, format, ...(typeof out === "string" ? { out } : {}) };
}
