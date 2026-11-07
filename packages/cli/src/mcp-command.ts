/** What `golem mcp …` was asked to do, or why the arguments do not make sense. */
/** What `golem mcp add` takes beyond the command or URL. It is present only when one of them was given. */
export interface AddOptions {
  /** `K=V`, or `K` alone for a secret that is asked for. */
  env: string[];
  headers: string[];
  cwd: string | null;
  onDemand: boolean;
  project: boolean;
  timeout: number | null;
  approval: "ask" | "allow" | null;
}

export type McpArgs =
  | { kind: "add"; name: string; command: string; args: string[]; tokenEnv: string | null; options?: AddOptions }
  | { kind: "add"; name: string; url: string; token: boolean; options?: AddOptions }
  /** A server from the daemon's catalog: its id, the name to give it (the entry's own when null), and typed inputs. */
  | { kind: "catalog"; id: string; name: string | null; inputs: Record<string, string> }
  | { kind: "remove"; name: string }
  /** The servers as the `mcpServers` JSON of another app. */
  | { kind: "export"; format: "claude" | "vscode"; scope: "user" | "project" }
  /** A catalog entry that is not saved: test it with the inputs and secrets it asks for. */
  | { kind: "testCatalog"; id: string; name: string | null; inputs: Record<string, string> }
  /** `$EDITOR` on a server's tables, saved through the daemon's checks. */
  | { kind: "edit"; name: string; project: boolean }
  /** Servers other apps have: from one app or a file (`from`), all the new ones at once, with this folder's files. */
  | { kind: "import"; from: string | null; all: boolean; project: boolean }
  | { kind: "list"; json: boolean }
  | { kind: "show"; name: string; json: boolean }
  | { kind: "test"; name: string }
  | { kind: "logs"; name: string; follow: boolean }
  | { kind: "enable"; name: string; onDemand: boolean }
  | { kind: "disable"; name: string }
  | { kind: "restart"; name: string }
  /** The tools of a server, and patterns to hide or show (`tools.exclude`) when any are given. */
  | { kind: "tools"; name: string; hide: string[]; show: string[] }
  | { kind: "error"; message: string };

export const MCP_USAGE =
  "usage: golem mcp list|show|test|logs|enable|disable|restart|tools|add|remove|export (golem --help lists the options)";

const SERVER_ACTIONS = new Set(["show", "test", "logs", "enable", "disable", "restart", "tools", "edit"]);

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function fail(message: string): McpArgs {
  return { kind: "error", message };
}

/** Parse the words after `golem mcp`. Everything after the first `--` is the server's command line. */
export function parseMcpArgs(args: string[]): McpArgs {
  const [action, ...rest] = args;
  if (action === "remove") {
    const [name, ...extra] = rest;
    if (name === undefined || name.length === 0 || extra.length > 0) {
      return fail("usage: golem mcp remove <name>");
    }
    return { kind: "remove", name };
  }
  if (action === "export") {
    return parseExportArgs(rest);
  }
  if (action === "test" && rest.includes("--catalog")) {
    const parsed = parseCatalogArgs(rest);
    return parsed.kind === "catalog" ? { kind: "testCatalog", id: parsed.id, name: parsed.name, inputs: parsed.inputs } : parsed;
  }
  if (action === "import") {
    return parseImportArgs(rest);
  }
  if (action !== undefined && SERVER_ACTIONS.has(action)) {
    return parseServerArgs(action, rest);
  }
  if (action === "list") {
    return parseServerArgs("list", rest);
  }
  if (action !== "add") {
    return fail(MCP_USAGE);
  }
  const split = rest.indexOf("--");
  const before = split === -1 ? rest : rest.slice(0, split);
  if (before.includes("--catalog")) {
    return split === -1 ? parseCatalogArgs(before) : fail("--catalog takes no command after --");
  }
  const after = split === -1 ? null : rest.slice(split + 1);
  let name: string | null = null;
  let url: string | null = null;
  let token = false;
  let tokenEnv: string | null = null;
  const options: AddOptions = { env: [], headers: [], cwd: null, onDemand: false, project: false, timeout: null, approval: null };
  let optioned = false;
  for (let index = 0; index < before.length; index += 1) {
    const word = before[index] ?? "";
    if (word === "--env" || word === "--header" || word === "--cwd" || word === "--timeout" || word === "--approval") {
      const value = before[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        return fail(`${word} needs a value`);
      }
      index += 1;
      optioned = true;
      if (word === "--env") options.env.push(value);
      else if (word === "--header") options.headers.push(value);
      else if (word === "--cwd") options.cwd = value;
      else if (word === "--timeout") {
        const seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) return fail("--timeout is a whole number of seconds, 1 to 3600");
        options.timeout = seconds;
      } else {
        if (value !== "ask" && value !== "allow") return fail("--approval is ask or allow");
        options.approval = value;
      }
    } else if (word === "--on-demand" || word === "--project") {
      optioned = true;
      if (word === "--on-demand") options.onDemand = true;
      else options.project = true;
    } else if (word === "--url" || word === "--token-env") {
      const value = before[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        return fail(`${word} needs a value`);
      }
      index += 1;
      if (word === "--url") url = value;
      else tokenEnv = value;
    } else if (word === "--token") {
      token = true;
    } else if (word.startsWith("-")) {
      return fail(`unknown option ${word}`);
    } else if (name === null) {
      name = word;
    } else {
      return fail(`unexpected ${word}: put the command after --`);
    }
  }
  if (name === null) {
    return fail("usage: golem mcp add <name> -- <command…> | golem mcp add <name> --url <url>");
  }
  if (url !== null) {
    if (after !== null) return fail("give either --url or a command after --, not both");
    if (tokenEnv !== null) return fail("--token-env is for a command; a url server sends its token as a header");
    return { kind: "add", name, url, token, ...(optioned ? { options } : {}) };
  }
  if (after === null) {
    return fail("give a command after -- or a server with --url");
  }
  const [command, ...commandArgs] = after;
  if (command === undefined || command.length === 0) {
    return fail("give the command to run after --");
  }
  if (token) {
    return fail("--token is for a url server; for a command use --token-env <VAR>");
  }
  if (tokenEnv !== null && !ENV_NAME.test(tokenEnv)) {
    return fail(`${tokenEnv} is not a variable name`);
  }
  return { kind: "add", name, command, args: commandArgs, tokenEnv, ...(optioned ? { options } : {}) };
}

const INPUT_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** `golem mcp add --catalog <id> [--name <name>] [--input <id>=<value>]…` */
function parseCatalogArgs(words: string[]): McpArgs {
  const usage = "usage: golem mcp add --catalog <id> [--name <name>] [--input <id>=<value>]…";
  let id: string | null = null;
  let name: string | null = null;
  const inputs: Record<string, string> = {};
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (word !== "--catalog" && word !== "--name" && word !== "--input") {
      return fail(word.startsWith("-") ? `unknown option ${word}` : `unexpected ${word}: ${usage}`);
    }
    const value = words[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return fail(`${word} needs a value`);
    }
    index += 1;
    if (word === "--catalog") {
      id = value;
    } else if (word === "--name") {
      name = value;
    } else {
      const at = value.indexOf("=");
      const key = at === -1 ? "" : value.slice(0, at);
      if (!INPUT_ID.test(key)) {
        return fail(`--input takes <id>=<value>, not ${value}`);
      }
      inputs[key] = value.slice(at + 1);
    }
  }
  return id === null ? fail(usage) : { kind: "catalog", id, name, inputs };
}

/** `golem mcp export [--json] [--format claude|vscode] [--scope user|project]`. The output is always JSON. */
function parseExportArgs(words: string[]): McpArgs {
  const usage = "usage: golem mcp export [--json] [--format claude|vscode] [--scope user|project]";
  let format: "claude" | "vscode" = "claude";
  let scope: "user" | "project" = "user";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (word === "--json") continue;
    if (word !== "--format" && word !== "--scope") {
      return fail(word.startsWith("-") ? `unknown option ${word}` : `unexpected ${word}: ${usage}`);
    }
    const value = words[index + 1];
    index += 1;
    if (word === "--format") {
      if (value !== "claude" && value !== "vscode") return fail(`--format is claude or vscode: ${usage}`);
      format = value;
    } else {
      if (value !== "user" && value !== "project") return fail(`--scope is user or project: ${usage}`);
      scope = value;
    }
  }
  return { kind: "export", format, scope };
}

/** `list`, and the commands that take one server's name: `show`, `test`, `logs`, `enable`, `disable`, `restart`, `tools`. */
function parseServerArgs(action: string, words: string[]): McpArgs {
  const usage: Record<string, string> = {
    list: "golem mcp list [--json]",
    show: "golem mcp show <name> [--json]",
    test: "golem mcp test <name>",
    logs: "golem mcp logs <name> [-f]",
    enable: "golem mcp enable <name> [--on-demand]",
    disable: "golem mcp disable <name>",
    restart: "golem mcp restart <name>",
    tools: "golem mcp tools <name> [--hide <glob>]… [--show <glob>]…",
    edit: "golem mcp edit <name> [--project]",
  };
  const allowed: Record<string, readonly string[]> = {
    list: ["--json"],
    show: ["--json"],
    test: [],
    logs: ["-f", "--follow"],
    enable: ["--on-demand"],
    disable: [],
    restart: [],
    tools: ["--hide", "--show"],
    edit: ["--project"],
  };
  let name: string | null = null;
  const flags = new Set<string>();
  const hide: string[] = [];
  const show: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (word.startsWith("-")) {
      if (!(allowed[action] ?? []).includes(word)) return fail(`unknown option ${word}: usage: ${usage[action]}`);
      if (word === "--hide" || word === "--show") {
        const value = words[index + 1];
        if (value === undefined || value.length === 0 || value.startsWith("--")) return fail(`${word} needs a pattern`);
        index += 1;
        (word === "--hide" ? hide : show).push(value);
      } else {
        flags.add(word);
      }
    } else if (action === "list" || name !== null) {
      return fail(`unexpected ${word}: usage: ${usage[action]}`);
    } else {
      name = word;
    }
  }
  if (action === "list") return { kind: "list", json: flags.has("--json") };
  if (name === null) return fail(`usage: ${usage[action]}`);
  switch (action) {
    case "show":
      return { kind: "show", name, json: flags.has("--json") };
    case "test":
      return { kind: "test", name };
    case "logs":
      return { kind: "logs", name, follow: flags.has("-f") || flags.has("--follow") };
    case "enable":
      return { kind: "enable", name, onDemand: flags.has("--on-demand") };
    case "disable":
      return { kind: "disable", name };
    case "restart":
      return { kind: "restart", name };
    case "edit":
      return { kind: "edit", name, project: flags.has("--project") };
    default:
      return { kind: "tools", name, hide, show };
  }
}

/** `golem mcp import [--from <app>|<file>] [--all] [--project]` */
function parseImportArgs(words: string[]): McpArgs {
  const usage = "usage: golem mcp import [--from claude-desktop|claude-code|cursor|vscode|windsurf|<file>] [--all] [--project]";
  let from: string | null = null;
  let all = false;
  let project = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (word === "--all") all = true;
    else if (word === "--project") project = true;
    else if (word === "--from") {
      const value = words[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) return fail("--from needs an app or a file");
      index += 1;
      from = value;
    } else {
      return fail(word.startsWith("-") ? `unknown option ${word}: ${usage}` : `unexpected ${word}: ${usage}`);
    }
  }
  return { kind: "import", from, all, project };
}
