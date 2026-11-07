/** What `golem mcp …` was asked to do, or why the arguments do not make sense. */
export type McpArgs =
  | { kind: "add"; name: string; command: string; args: string[]; tokenEnv: string | null }
  | { kind: "add"; name: string; url: string; token: boolean }
  /** A server from the daemon's catalog: its id, the name to give it (the entry's own when null), and typed inputs. */
  | { kind: "catalog"; id: string; name: string | null; inputs: Record<string, string> }
  | { kind: "remove"; name: string }
  /** The servers as the `mcpServers` JSON of another app. */
  | { kind: "export"; format: "claude" | "vscode"; scope: "user" | "project" }
  | { kind: "error"; message: string };

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
  if (action !== "add") {
    return fail("usage: golem mcp add|remove <name> | golem mcp export [--format claude|vscode] [--scope user|project]");
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
  for (let index = 0; index < before.length; index += 1) {
    const word = before[index] ?? "";
    if (word === "--url" || word === "--token-env") {
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
    return { kind: "add", name, url, token };
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
  return { kind: "add", name, command, args: commandArgs, tokenEnv };
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
