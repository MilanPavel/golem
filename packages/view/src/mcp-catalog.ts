import type { McpAddParams } from "@golem/client";

/**
 * The short list `/mcp add` offers (step 1.12.2): common servers, one pick away. Pure,
 * so the terminal app adds them and the web UI shows the command to run.
 */

/** What an entry adds: `mcp.add`'s params without the token, which is typed apart and never kept here. */
export type McpAddSpec = Omit<McpAddParams, "token">;

export type McpCatalogId = "filesystem" | "github" | "fetch" | "other";

export type McpCatalogEntry = {
  id: McpCatalogId;
  /** The name of the server, as `/mcp` lists it. `other` has none: the user picks it. */
  name: string | null;
  label: (folder: string) => string;
  description: string;
  needsToken: boolean;
  /** `null` for `other`, which asks for a name and a command or URL. */
  params: ((folder: string) => McpAddSpec) | null;
  /** The exact `golem mcp add …` line for the same server. With no folder, it says `<folder>`. */
  cliCommand: (folder: string | null) => string;
};

export const GITHUB_TOKEN_HINT =
  "Make a token at github.com/settings/personal-access-tokens/new: pick the repos under Repository access, then add Contents, Issues, and Pull requests.";

export const GITHUB_URL = "https://api.githubcopilot.com/mcp/";

/** The daemon's rule for a server name. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;

export function mcpNameError(name: string): string | null {
  if (name.length === 0) {
    return "Give the server a name.";
  }
  return NAME.test(name) ? null : "Use letters, digits, and dashes, up to 32, starting with a letter or digit.";
}

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  {
    id: "filesystem",
    name: "filesystem",
    label: (folder) => `Filesystem: ${folder}`,
    description: "Read and write files in the session folder.",
    needsToken: false,
    params: (folder) => ({ name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", folder] }),
    cliCommand: (folder) =>
      `golem mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem ${folder === null ? "<folder>" : shellQuote(folder)}`,
  },
  {
    id: "github",
    name: "github",
    label: () => "GitHub",
    description: "Repos, issues, and pull requests. Asks for a token.",
    needsToken: true,
    params: () => ({ name: "github", url: GITHUB_URL }),
    cliCommand: () => `golem mcp add github --url ${GITHUB_URL} --token`,
  },
  {
    id: "fetch",
    name: "fetch",
    label: () => "Fetch",
    description: "Read web pages as text.",
    needsToken: false,
    params: () => ({ name: "fetch", command: "uvx", args: ["mcp-server-fetch"] }),
    cliCommand: () => "golem mcp add fetch -- uvx mcp-server-fetch",
  },
  {
    id: "other",
    name: null,
    label: () => "Other",
    description: "Type a name, then a command or a URL.",
    needsToken: false,
    params: null,
    cliCommand: () => "golem mcp add <name> -- <command…>",
  },
];

export const MCP_CATALOG_IDS: readonly string[] = MCP_CATALOG.map((entry) => entry.id);

export function catalogEntry(id: string): McpCatalogEntry | null {
  return MCP_CATALOG.find((entry) => entry.id === id) ?? null;
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
