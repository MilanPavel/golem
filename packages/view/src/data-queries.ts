// The words and small rules of saved queries, shared by the web, the CLI and the TUI.

export const SAVE_QUERY_BUTTON = "Save query";
export const SAVE_QUERY_TITLE = "Save this query";
export const NEW_QUERY_BUTTON = "New query";
export const NEW_QUERY_TITLE = "New query";
export const QUERY_NAME_LABEL = "Name";
export const QUERY_ANSWERS_LABEL = "What it answers";
export const QUERY_ANSWERS_NOTE = "optional, the model reads it";
export const QUERY_SQL_LABEL = "SQL";
export const QUERY_TRY_BUTTON = "Try";
export const QUERIES_LEDE = "Saved with this source · the model reads the names, what they answer and the SQL";
export const QUERY_MAX_NAME = 80;
/** How many rows Try fetches. It is a look, not the result. */
export const TRY_ROWS = 10;

/** The title of the dialog that changes a query. */
export function editQueryTitle(name: string): string {
  return `Edit "${name}"`;
}

/** The question the dialog asks when the name is taken. */
export function replaceQuestion(name: string): string {
  return `Replace "${name}"?`;
}

/** The daemon refused a name that a query already has. */
export function isTakenName(message: string): boolean {
  return /already a query called/i.test(message);
}

/** Where a source keeps its saved queries, in words. `project` is a source of the open folder. */
export function queriesSavedText(source: string, scope: "builtin" | "user" | "project"): string {
  const file = `data/${source}/queries.toml`;
  if (scope === "project") return `Saved with ${source} in .golem/${file} in this project, next to its DATA.md, so they are kept with the project.`;
  return `Saved with ${source} in ~/.golem/${file}. A project's source keeps them in the project instead.`;
}

const OPENERS = /^(?:please\s+|can you\s+|could you\s+|show me\s+|tell me\s+|give me\s+|what(?:'s| is| are)\s+|how (?:much|many) (?:did|do|does|have|has)\s+(?:i|we|you)\s+|how (?:much|many)\s+|which\s+|who\s+)/i;

/** A short title for a query, from the question that made it. */
export function suggestQueryName(question: string | null): string {
  const first = (question ?? "").trim().split(/\r?\n/)[0] ?? "";
  let text = first.replace(/[?!.\s]+$/, "").replace(/^@\w+\s+/, "");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text.replace(OPENERS, "");
    if (next === text) break;
    text = next;
  }
  text = text.trim();
  if (text === "") return "";
  if (text.length > 60) {
    const cut = text.slice(0, 60);
    text = cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trim();
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Null when the name can be saved (1 to 80 characters once trimmed), else a sentence. */
export function queryNameProblem(name: string): string | null {
  const text = name.trim();
  if (text === "") return "Give the query a name.";
  if (text.length > QUERY_MAX_NAME) return `A name is at most ${String(QUERY_MAX_NAME)} characters.`;
  return null;
}

/** The SQL on one line, cut for a row of a list. */
export function oneLineSql(sql: string, max = 140): string {
  const one = sql.split(/\s+/).filter((word) => word !== "").join(" ");
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

export interface LastRunLike {
  last_run_at?: string | null | undefined;
  last_rows?: number | null | undefined;
  last_ms?: number | null | undefined;
  last_error?: string | null | undefined;
}

export type LastRun = { failed: false; when: string; detail: string | null } | { failed: true; when: string; detail: string };

const DAY = 86_400_000;

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** When a run was, in words: `today 09:14`, `yesterday 09:14`, `3 days ago`, or the date. */
export function savedRunWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const start = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(now) - start(at)) / DAY);
  if (days <= 0) return `today ${clock(at)}`;
  if (days === 1) return `yesterday ${clock(at)}`;
  if (days < 14) return `${String(days)} days ago`;
  return at.toISOString().slice(0, 10);
}

/** What a row says of the last run, or null when the query never ran. A failed run gives the engine's first line. */
export function lastRunOf(query: LastRunLike, now: Date): LastRun | null {
  if (query.last_run_at === null || query.last_run_at === undefined) return null;
  const when = savedRunWhen(query.last_run_at, now);
  if (query.last_error !== null && query.last_error !== undefined && query.last_error !== "") {
    return { failed: true, when, detail: query.last_error.split("\n")[0] ?? "" };
  }
  const parts: string[] = [];
  if (query.last_rows !== null && query.last_rows !== undefined) parts.push(query.last_rows === 1 ? "1 row" : `${String(query.last_rows)} rows`);
  if (query.last_ms !== null && query.last_ms !== undefined) parts.push(`${String(query.last_ms)} ms`);
  return { failed: false, when, detail: parts.length === 0 ? null : parts.join(" · ") };
}

/** The line above a result that just ran from the Queries tab: `Ran now · 11 rows · 38 ms`. */
export function ranNowText(rows: number, ms: number): string {
  return `Ran now · ${rows === 1 ? "1 row" : `${String(rows)} rows`} · ${String(ms)} ms`;
}

/** What Try says after a run. */
export function triedText(rows: number, ms: number): string {
  return `${rows === 1 ? "1 row" : `${String(rows)} rows`} · ${String(ms)} ms`;
}
