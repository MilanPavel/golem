import type { McpAddParams, McpCatalogEntry, McpCatalogInput } from "@golem/client";

/**
 * The servers `/mcp add` offers. The list lives in the daemon (`mcp.catalog`), so this file
 * only turns an entry into what a screen needs: a label, the inputs to ask, the params to
 * send, and the command line that does the same. Pure, so every UI shares it.
 */

export type { McpCatalogEntry, McpCatalogInput };

/** What an add sends: `mcp.add`'s params without the token, which is typed apart and never kept here. */
export type McpAddSpec = Omit<McpAddParams, "token">;

/** The pick that is not a catalog entry: a name, then a command or a URL. */
export const OTHER_ID = "other";

/** The daemon's rule for a server name. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;

export function mcpNameError(name: string): string | null {
  if (name.length === 0) {
    return "Give the server a name.";
  }
  return NAME.test(name) ? null : "Use letters, digits, and dashes, up to 32, starting with a letter or digit.";
}

export function findEntry(entries: readonly McpCatalogEntry[], id: string | null): McpCatalogEntry | null {
  return entries.find((entry) => entry.id === id) ?? null;
}

/** Whether the user can pick it now: the daemon says what an entry lacks, such as sign-in. */
export function entryAvailable(entry: McpCatalogEntry): boolean {
  return entry.available !== false;
}

/** The entry's title, with where it will point when it has a path input. */
export function entryLabel(entry: McpCatalogEntry): string {
  return entry.title;
}

/**
 * The entry's one-line description, with what is missing or why it can't be added. A server
 * that is already there says so.
 */
export function entryNote(entry: McpCatalogEntry): string {
  if (entry.added === true) {
    return `${entry.description} Already added.`;
  }
  if (!entryAvailable(entry)) {
    return `${entry.description} ${entry.reason ?? "Not available."}`;
  }
  return entry.description;
}

/** An input's starting text, with `{folder}` filled in. */
export function inputDefault(input: McpCatalogInput, folder: string): string {
  return (input.default ?? "").replaceAll("{folder}", folder);
}

/** The inputs a person types, in the entry's order. */
export function entryInputs(entry: McpCatalogEntry): readonly McpCatalogInput[] {
  return entry.inputs ?? [];
}

/** Why `value` can't fill `input`, or null. */
export function inputError(input: McpCatalogInput, value: string): string | null {
  if (value.trim().length === 0) {
    return input.required === false ? null : `${input.label} is needed.`;
  }
  if (input.kind === "choice" && !(input.choices ?? []).includes(value.trim())) {
    return `Pick one of: ${(input.choices ?? []).join(", ")}.`;
  }
  return null;
}

/**
 * The `mcp.add` params for an entry: text inputs go in `inputs`, secret inputs in `secrets`
 * (keyed by input id). The daemon fills the template and stores secrets in the Keychain.
 */
export function entryParams(entry: McpCatalogEntry, values: Readonly<Record<string, string>>): McpAddParams {
  const inputs: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const input of entryInputs(entry)) {
    const value = (values[input.id] ?? "").trim();
    if (value.length === 0) {
      continue;
    }
    if (input.kind === "secret") {
      secrets[input.id] = value;
    } else {
      inputs[input.id] = value;
    }
  }
  return { name: entry.name, catalog_id: entry.id, inputs, secrets };
}

/** The `golem mcp add --catalog …` line for the same server. It asks for any secret, hidden. */
export function cliCommand(entry: McpCatalogEntry | null): string {
  if (entry === null) {
    return "golem mcp add <name> -- <command…>";
  }
  const inputs = entryInputs(entry).filter((input) => input.kind !== "secret" && input.required !== false && input.default == null);
  const flags = inputs.map((input) => ` --input ${input.id}=<${input.label.toLowerCase()}>`).join("");
  return `golem mcp add --catalog ${entry.id}${flags}`;
}

/** Split a command line on whitespace; '…' and "…" keep their spaces. No escapes. */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let open = false;
  let quote: string | null = null;
  for (const char of line) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      open = true;
    } else if (/\s/.test(char)) {
      if (open || current.length > 0) {
        words.push(current);
      }
      current = "";
      open = false;
    } else {
      current += char;
    }
  }
  if (open || current.length > 0) {
    words.push(current);
  }
  return words;
}

/** The server for `other`'s command line or URL, or what is wrong with it. */
export function otherSpec(name: string, line: string): { spec: McpAddSpec } | { error: string } {
  const text = line.trim();
  if (text.length === 0) {
    return { error: "Type a command or an https:// URL." };
  }
  if (/^https?:\/\//.test(text)) {
    return /\s/.test(text) ? { error: "A URL has no spaces." } : { spec: { name, url: text } };
  }
  if (quoteIsOpen(text)) {
    return { error: "A quote is not closed." };
  }
  const [command, ...args] = splitCommandLine(text);
  if (command === undefined || command.length === 0) {
    return { error: "Type a command or an https:// URL." };
  }
  return { spec: { name, command, args } };
}

function quoteIsOpen(text: string): boolean {
  let quote: string | null = null;
  for (const char of text) {
    if (quote === null && (char === "'" || char === '"')) {
      quote = char;
    } else if (char === quote) {
      quote = null;
    }
  }
  return quote !== null;
}

/** A word safe to paste into a shell: plain words stay as they are, the rest go in single quotes. */
export function shellQuote(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
