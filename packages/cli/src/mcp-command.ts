/** What `golem mcp …` was asked to do, or why the arguments do not make sense. */
export type McpArgs =
  | { kind: "add"; name: string; command: string; args: string[]; tokenEnv: string | null }
  | { kind: "add"; name: string; url: string; token: boolean }
  | { kind: "remove"; name: string }
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
  if (action !== "add") {
    return fail("usage: golem mcp add|remove <name>");
  }
  const split = rest.indexOf("--");
  const before = split === -1 ? rest : rest.slice(0, split);
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
