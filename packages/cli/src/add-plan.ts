import type { McpServerConfig } from "../../protocol/gen/mcp-server-detail.ts";
import type { AddOptions } from "./mcp-command.ts";

/** A secret `golem mcp add` stores in the Keychain: where the config names it, and its value (null: ask for it). */
export interface SecretSlot {
  ref: string;
  /** What to call it when asking, as in `GITHUB_TOKEN for github`. */
  label: string;
  value: string | null;
}

export interface AddPlan {
  config: McpServerConfig;
  secrets: SecretSlot[];
  scope: "user" | "project";
}

export type AddPlanResult = { ok: true; plan: AddPlan } | { ok: false; message: string };

/** Mirrors `SECRET_KEY` in the daemon's config: a name that ends in a word such as token, key, or password. */
const SECRET_KEY = /(^|_)(api_?key|key|token|password|passwd|secret|credentials?|authorization|bearer)$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BEARER = /^Bearer\s+(\S.*)$/i;

/** Whether the daemon would insist a variable or header of this name names a secret. Dashes count as `_`. */
export function looksSecret(key: string): boolean {
  return SECRET_KEY.test(key.replaceAll("-", "_"));
}

export type AddInput =
  | { name: string; command: string; args: string[]; tokenEnv: string | null; options?: AddOptions }
  | { name: string; url: string; token: boolean; options?: AddOptions };

const NO_OPTIONS: AddOptions = { env: [], headers: [], cwd: null, onDemand: false, project: false, timeout: null, approval: null };

function split(entry: string): { key: string; value: string | null } {
  const at = entry.indexOf("=");
  return at === -1 ? { key: entry, value: null } : { key: entry.slice(0, at), value: entry.slice(at + 1) };
}

/**
 * The config for `golem mcp add` with options, and the secrets it needs. A variable or header whose name looks
 * like a secret goes to the Keychain: `K=V` stores V, and `K` alone is asked for, hidden, so it stays out of
 * the shell's history. The first secret is `mcp/<name>`, the next ones `mcp/<name>-<key>`.
 */
export function planAdd(input: AddInput): AddPlanResult {
  const options = input.options ?? NO_OPTIONS;
  const stdio = "command" in input;
  if (stdio && options.headers.length > 0) return { ok: false, message: "--header is for a url server; a command takes --env" };
  if (!stdio && options.env.length > 0) return { ok: false, message: "--env is for a command; a url server takes --header" };
  if (!stdio && options.cwd !== null) return { ok: false, message: "--cwd is for a command" };
  const secrets: SecretSlot[] = [];
  const claim = (key: string, value: string | null): string => {
    const ref = secrets.length === 0 ? `mcp/${input.name}` : `mcp/${input.name}-${key.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}`;
    secrets.push({ ref, label: `${key} for ${input.name}`, value });
    return ref;
  };
  const table: Record<string, string> = {};
  const put = (key: string, text: string): string | null => {
    if (key in table) return `${key} is given twice`;
    table[key] = text;
    return null;
  };
  if (stdio && input.tokenEnv !== null) {
    const failed = put(input.tokenEnv, `keychain:${claim(input.tokenEnv, null)}`);
    if (failed !== null) return { ok: false, message: failed };
  }
  if (!stdio && input.token) {
    put("Authorization", `Bearer keychain:${claim("token", null)}`);
  }
  for (const entry of stdio ? options.env : options.headers) {
    const { key, value } = split(entry);
    if (stdio ? !ENV_NAME.test(key) : key.length === 0 || /\s/.test(key)) {
      return { ok: false, message: `${key || entry} is not a ${stdio ? "variable" : "header"} name` };
    }
    const bearer = value === null ? null : BEARER.exec(value);
    const asked = value === null;
    let text: string;
    if (asked && !looksSecret(key)) {
      return { ok: false, message: `${key} needs a value: ${stdio ? "--env" : "--header"} ${key}=<value>` };
    }
    if (bearer !== null) {
      text = `Bearer keychain:${claim(key, bearer[1] ?? "")}`;
    } else if (asked || looksSecret(key)) {
      const prefix = !stdio && key.toLowerCase() === "authorization" ? "Bearer " : "";
      text = `${prefix}keychain:${claim(key, asked ? null : (value ?? ""))}`;
    } else {
      text = value ?? "";
    }
    const failed = put(key, text);
    if (failed !== null) return { ok: false, message: failed };
  }
  const config: McpServerConfig = stdio
    ? {
        command: input.command,
        ...(input.args.length > 0 ? { args: input.args } : {}),
        ...(Object.keys(table).length > 0 ? { env: table } : {}),
        ...(options.cwd === null ? {} : { cwd: options.cwd }),
      }
    : { url: input.url, ...(Object.keys(table).length > 0 ? { headers: table } : {}) };
  if (options.onDemand) config.enabled = "on_demand";
  if (options.timeout !== null) config.timeout_seconds = options.timeout;
  if (options.approval !== null && options.approval !== "ask") config.approval = options.approval;
  return { ok: true, plan: { config, secrets, scope: options.project ? "project" : "user" } };
}
