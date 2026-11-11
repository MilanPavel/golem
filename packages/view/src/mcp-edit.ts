import type { McpServerConfig } from "@golem/client";
import { otherSpec, shellQuote } from "./mcp-catalog.ts";

/**
 * The edit form of one MCP server: what a screen shows, and the `mcp.update` it sends. Pure, so
 * every UI shares it. A secret is never read back: a value that names the Keychain stays a
 * reference, and typing in its field replaces the stored value.
 */

/** One `env` or `headers` row. `ref` is the Keychain reference a stored secret already has. */
export type EditPair = { key: string; value: string; secret: boolean; ref: string | null };

export type EditForm = {
  target: "command" | "url";
  /** The command with its arguments, as one line. */
  command: string;
  url: string;
  cwd: string;
  timeout: string;
  approval: "ask" | "read-only" | "allow";
  /** One `fnmatch` pattern per line. */
  include: string;
  exclude: string;
  env: EditPair[];
  headers: EditPair[];
};

const KEYCHAIN = "keychain:";

function pairs(values: Readonly<Record<string, string>> | undefined): EditPair[] {
  return Object.entries(values ?? {}).map(([key, value]) =>
    value.startsWith(KEYCHAIN)
      ? { key, value: "", secret: true, ref: value.slice(KEYCHAIN.length) }
      : { key, value, secret: false, ref: null },
  );
}

/** The form for a server's config (from `mcp.get`). */
export function editForm(config: McpServerConfig): EditForm {
  const url = config.url ?? "";
  return {
    target: url.length > 0 ? "url" : "command",
    command: [config.command ?? "", ...(config.args ?? [])].filter((word, at) => at > 0 || word.length > 0).map(shellQuote).join(" "),
    url,
    cwd: config.cwd ?? "",
    timeout: config.timeout_seconds === undefined ? "" : String(config.timeout_seconds),
    approval: config.approval ?? "ask",
    include: (config.tools?.include ?? []).join("\n"),
    exclude: (config.tools?.exclude ?? []).join("\n"),
    env: pairs(config.env),
    headers: pairs(config.headers),
  };
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_KEY = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function slug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildPairs(
  rows: readonly EditPair[],
  label: string,
  keyPattern: RegExp,
  name: string,
  secrets: Record<string, string>,
): { values: Record<string, string> } | { error: string } {
  const values: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key.length === 0) {
      return { error: `A ${label} has no name.` };
    }
    if (!keyPattern.test(key)) {
      return { error: `"${key}" is not a valid ${label} name.` };
    }
    if (key in values) {
      return { error: `${key} is there twice.` };
    }
    if (!row.secret) {
      values[key] = row.value;
      continue;
    }
    const ref = row.ref ?? `mcp/${name}-${slug(key)}`;
    if (row.value.length === 0 && row.ref === null) {
      return { error: `Type the secret for ${key}.` };
    }
    if (row.value.length > 0) {
      secrets[ref] = row.value;
    }
    values[key] = `${KEYCHAIN}${ref}`;
  }
  return { values };
}

/** The `mcp.update` body for the form, or what is wrong with it. Fields the form does not show are kept. */
export function updateFromForm(
  name: string,
  original: McpServerConfig,
  form: EditForm,
): { config: McpServerConfig; secrets: Record<string, string> } | { error: string } {
  const target = otherSpec(name, form.target === "url" ? form.url : form.command);
  if ("error" in target) {
    return target;
  }
  const secrets: Record<string, string> = {};
  const env = buildPairs(form.env, "variable", ENV_KEY, name, secrets);
  if ("error" in env) {
    return env;
  }
  const headers = buildPairs(form.headers, "header", HEADER_KEY, name, secrets);
  if ("error" in headers) {
    return headers;
  }
  const timeout = form.timeout.trim();
  if (timeout.length > 0 && !(Number(timeout) > 0)) {
    return { error: "The timeout is a number of seconds above 0." };
  }
  // What the form shows is rebuilt below. Everything else (`enabled`, and fields a later version adds) is kept.
  const config: McpServerConfig = { ...original, approval: form.approval };
  for (const shown of ["command", "args", "url", "cwd", "env", "headers", "tools", "timeout_seconds"] as const) {
    delete config[shown];
  }
  if (target.spec.url != null) {
    config.url = target.spec.url;
  } else {
    config.command = target.spec.command ?? "";
    config.args = target.spec.args ?? [];
  }
  if (form.cwd.trim().length > 0) {
    config.cwd = form.cwd.trim();
  }
  if (timeout.length > 0) {
    config.timeout_seconds = Number(timeout);
  }
  if (Object.keys(env.values).length > 0) {
    config.env = env.values;
  }
  if (Object.keys(headers.values).length > 0) {
    config.headers = headers.values;
  }
  const include = lines(form.include);
  const exclude = lines(form.exclude);
  if (include.length > 0 || exclude.length > 0) {
    config.tools = { include, exclude };
  }
  return { config, secrets };
}
