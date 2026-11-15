import type { AuthKeyStatus } from "@golem/client";

import { hostedProvider } from "./setup-key.ts";

/** A server the page can name: its `mcp.list` name, and the catalog's title for it when there is one. */
export type KeyServer = { name: string; title?: string };

/** One key of the API keys page: what it is for, whether golem has it, where, and the commands that set it. */
export type KeyRow = {
  /** The `auth.list` provider: `anthropic`, `mcp/github-oauth`. */
  ref: string;
  /** The provider's display name, or the server's title. */
  name: string;
  /** What it is: `Claude`, `token`, `OAuth sign-in`. */
  blurb: string;
  saved: boolean;
  /** Where the key is kept, null while it is missing. */
  source: "keychain" | "env" | null;
  envVar: string | null;
  /** The MCP server the ref belongs to, null for a model provider. */
  server: string | null;
  /** The server is one `mcp.list` has, so the MCP servers tab can open it. */
  serverKnown: boolean;
  /** What stores or replaces the key. */
  setCommand: string;
  /** What removes it, null when the key is missing or is an environment variable, which golem cannot unset. */
  removeCommand: string | null;
};

export type KeyGroups = { models: KeyRow[]; mcp: KeyRow[] };

const OAUTH = "-oauth";
const CUSTOM = "custom · OpenAI-compatible";

/**
 * The server an `mcp/<name>`, `mcp/<name>-<input>` or `mcp/<name>-oauth` ref belongs to, and what is
 * left of the ref. The longest listed name wins, so `mcp/brave-search` is one server and not `brave`
 * with a `search` input. With no listed server the ref is its own server.
 */
export function mcpRefParts(ref: string, servers: readonly KeyServer[]): { server: string; known: boolean; input: string; oauth: boolean } {
  const rest = ref.startsWith("mcp/") ? ref.slice("mcp/".length) : ref;
  const oauth = rest.endsWith(OAUTH);
  const base = oauth ? rest.slice(0, -OAUTH.length) : rest;
  const found = servers
    .filter((server) => base === server.name || base.startsWith(`${server.name}-`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (found === undefined) {
    return { server: base, known: false, input: "", oauth };
  }
  return { server: found.name, known: true, input: base.slice(found.name.length + 1), oauth };
}

function savedFirst(a: KeyRow, b: KeyRow): number {
  return Number(b.saved) - Number(a.saved) || a.name.localeCompare(b.name);
}

function row(status: AuthKeyStatus, fields: Pick<KeyRow, "name" | "blurb" | "server" | "serverKnown" | "setCommand">): KeyRow {
  const source = status.source === "env" || status.source === "keychain" ? status.source : null;
  return {
    ref: status.provider,
    ...fields,
    saved: source !== null,
    source,
    envVar: status.env_var ?? null,
    removeCommand: source === "keychain" ? `golem auth remove ${status.provider}` : null,
  };
}

/**
 * The rows of the API keys page: the model providers that take a key, then every `mcp/*` ref. Saved keys
 * come first in each group, then A to Z by name. `servers` are the MCP servers the page knows.
 */
export function keyGroups(providers: readonly AuthKeyStatus[], servers: readonly KeyServer[]): KeyGroups {
  const models: KeyRow[] = [];
  const mcp: KeyRow[] = [];
  for (const status of providers) {
    if (status.provider.startsWith("mcp/")) {
      const { server, known, input, oauth } = mcpRefParts(status.provider, servers);
      mcp.push(
        row(status, {
          name: servers.find((item) => item.name === server)?.title ?? server,
          blurb: oauth ? "OAuth sign-in" : input === "" ? "token" : `${input} input`,
          server,
          serverKnown: known,
          setCommand: oauth ? `golem mcp login ${server}` : `golem auth set ${status.provider}`,
        }),
      );
    } else if (status.takes_key) {
      const hosted = hostedProvider(status.provider);
      models.push(
        row(status, {
          name: hosted?.name ?? status.provider,
          blurb: hosted?.blurb ?? CUSTOM,
          server: null,
          serverKnown: false,
          setCommand: `golem auth set ${status.provider}`,
        }),
      );
    }
  }
  return { models: models.sort(savedFirst), mcp: mcp.sort(savedFirst) };
}

/** The saved and the total count of a list of rows. */
export function savedCount(rows: readonly KeyRow[]): { saved: number; total: number } {
  return { saved: rows.filter((item) => item.saved).length, total: rows.length };
}
