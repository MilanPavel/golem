import assert from "node:assert/strict";
import { test } from "node:test";

import type { GolemClient, McpLoginDone } from "@golem/client";

import { parseMcpArgs } from "./mcp-command.ts";
import { formatMcpList } from "./mcp-format.ts";
import { runMcpLogin, type LoginDeps } from "./mcp-run.ts";

test("a command after -- is kept verbatim, flags and all", () => {
  assert.deepEqual(parseMcpArgs(["add", "git", "--", "uvx", "mcp-server-git", "--repository", "."]), {
    kind: "add",
    name: "git",
    command: "uvx",
    args: ["mcp-server-git", "--repository", "."],
    tokenEnv: null,
  });
});

test("only the first -- splits, and --token-env comes before it", () => {
  assert.deepEqual(parseMcpArgs(["add", "x", "--token-env", "API_TOKEN", "--", "run", "--", "--url"]), {
    kind: "add",
    name: "x",
    command: "run",
    args: ["--", "--url"],
    tokenEnv: "API_TOKEN",
  });
});

test("a url server takes --token, in any order", () => {
  const url = "https://api.githubcopilot.com/mcp/";
  assert.deepEqual(parseMcpArgs(["add", "github", "--url", url, "--token"]), {
    kind: "add",
    name: "github",
    url,
    token: true,
  });
  assert.deepEqual(parseMcpArgs(["add", "--token", "--url", url, "github"]), {
    kind: "add",
    name: "github",
    url,
    token: true,
  });
  assert.deepEqual(parseMcpArgs(["add", "github", "--url", url]), { kind: "add", name: "github", url, token: false });
});

test("remove takes one name", () => {
  assert.deepEqual(parseMcpArgs(["remove", "git"]), { kind: "remove", name: "git" });
  assert.equal(parseMcpArgs(["remove"]).kind, "error");
  assert.equal(parseMcpArgs(["remove", "a", "b"]).kind, "error");
});

test("bad combinations say what to change", () => {
  const message = (args: string[]): string => {
    const parsed = parseMcpArgs(args);
    assert.equal(parsed.kind, "error");
    return parsed.kind === "error" ? parsed.message : "";
  };
  assert.match(message([]), /usage/);
  assert.match(message(["add"]), /usage/);
  assert.match(message(["add", "x"]), /after --/);
  assert.match(message(["add", "x", "--"]), /command to run/);
  assert.match(message(["add", "x", "--url", "https://e.com", "--", "cmd"]), /not both/);
  assert.match(message(["add", "x", "--url"]), /needs a value/);
  assert.match(message(["add", "x", "--url", "https://e.com", "--token-env", "T"]), /for a command/);
  assert.match(message(["add", "x", "--token", "--", "cmd"]), /--token-env/);
  assert.match(message(["add", "x", "--token-env", "1bad", "--", "cmd"]), /not a variable name/);
  assert.match(message(["add", "x", "--nope", "--", "cmd"]), /unknown option/);
  assert.match(message(["add", "x", "y", "--", "cmd"]), /after --/);
});

test("--catalog takes an id, an optional name, and typed inputs", () => {
  assert.deepEqual(parseMcpArgs(["add", "--catalog", "github"]), { kind: "catalog", id: "github", name: null, inputs: {} });
  assert.deepEqual(
    parseMcpArgs(["add", "--catalog", "filesystem", "--name", "docs", "--input", "folder=/a b", "--input", "x=y=z"]),
    { kind: "catalog", id: "filesystem", name: "docs", inputs: { folder: "/a b", x: "y=z" } },
  );
});

test("--catalog says what is wrong", () => {
  const message = (args: string[]): string => {
    const parsed = parseMcpArgs(args);
    assert.equal(parsed.kind, "error");
    return parsed.kind === "error" ? parsed.message : "";
  };
  assert.match(message(["add", "--catalog"]), /needs a value/);
  assert.match(message(["add", "--input", "a=b", "--catalog"]), /needs a value/);
  assert.match(message(["add", "--catalog", "x", "--input", "nope"]), /<id>=<value>/);
  assert.match(message(["add", "--catalog", "x", "--url", "https://e.com"]), /unknown option --url/);
  assert.match(message(["add", "--catalog", "x", "extra"]), /unexpected extra/);
  assert.match(message(["add", "--catalog", "x", "--", "cmd"]), /takes no command/);
});

test("a --catalog after -- is part of the server's command", () => {
  assert.deepEqual(parseMcpArgs(["add", "x", "--", "run", "--catalog", "y"]), {
    kind: "add",
    name: "x",
    command: "run",
    args: ["--catalog", "y"],
    tokenEnv: null,
  });
});

test("export defaults to the Claude format and the user's servers", () => {
  assert.deepEqual(parseMcpArgs(["export"]), { kind: "export", format: "claude", scope: "user" });
  assert.deepEqual(parseMcpArgs(["export", "--json"]), { kind: "export", format: "claude", scope: "user" });
  assert.deepEqual(parseMcpArgs(["export", "--format", "vscode", "--scope", "project"]), {
    kind: "export",
    format: "vscode",
    scope: "project",
  });
});

test("export refuses an unknown format, scope, or word", () => {
  const message = (words: string[]): string => {
    const parsed = parseMcpArgs(words);
    assert.equal(parsed.kind, "error");
    return parsed.kind === "error" ? parsed.message : "";
  };
  assert.match(message(["export", "--format", "toml"]), /claude or vscode/);
  assert.match(message(["export", "--format"]), /claude or vscode/);
  assert.match(message(["export", "--scope", "team"]), /user or project/);
  assert.match(message(["export", "--all"]), /unknown option --all/);
  assert.match(message(["export", "github"]), /unexpected github/);
});

test("list, show, test, logs, enable, disable, restart, and tools read their words", () => {
  assert.deepEqual(parseMcpArgs(["list"]), { kind: "list", json: false });
  assert.deepEqual(parseMcpArgs(["list", "--json"]), { kind: "list", json: true });
  assert.deepEqual(parseMcpArgs(["show", "git", "--json"]), { kind: "show", name: "git", json: true });
  assert.deepEqual(parseMcpArgs(["test", "git"]), { kind: "test", name: "git" });
  assert.deepEqual(parseMcpArgs(["logs", "git", "-f"]), { kind: "logs", name: "git", follow: true });
  assert.deepEqual(parseMcpArgs(["logs", "--follow", "git"]), { kind: "logs", name: "git", follow: true });
  assert.deepEqual(parseMcpArgs(["enable", "git", "--on-demand"]), { kind: "enable", name: "git", onDemand: true });
  assert.deepEqual(parseMcpArgs(["enable", "git"]), { kind: "enable", name: "git", onDemand: false });
  assert.deepEqual(parseMcpArgs(["disable", "git"]), { kind: "disable", name: "git" });
  assert.deepEqual(parseMcpArgs(["restart", "git"]), { kind: "restart", name: "git" });
  assert.deepEqual(parseMcpArgs(["tools", "git"]), { kind: "tools", name: "git", hide: [], show: [] });
  assert.deepEqual(parseMcpArgs(["tools", "git", "--hide", "a_*", "--hide", "b", "--show", "c"]), {
    kind: "tools",
    name: "git",
    hide: ["a_*", "b"],
    show: ["c"],
  });
});

test("these commands refuse a missing name, a stray word, and an option they do not have", () => {
  const message = (words: string[]): string => {
    const parsed = parseMcpArgs(words);
    assert.equal(parsed.kind, "error");
    return parsed.kind === "error" ? parsed.message : "";
  };
  assert.match(message(["show"]), /usage: golem mcp show <name>/);
  assert.match(message(["list", "git"]), /unexpected git/);
  assert.match(message(["show", "a", "b"]), /unexpected b/);
  assert.match(message(["disable", "git", "--on-demand"]), /unknown option --on-demand/);
  assert.match(message(["tools", "git", "--hide"]), /needs a pattern/);
  assert.match(message(["tools", "git", "--hide", "--show", "x"]), /needs a pattern/);
  assert.match(message(["nope"]), /usage: golem mcp list/);
});

test("add takes env, header, cwd, on-demand, project, timeout, and approval before the command", () => {
  assert.deepEqual(
    parseMcpArgs(["add", "x", "--env", "A=1", "--env", "TOKEN", "--cwd", "/w", "--on-demand", "--project", "--timeout", "30", "--approval", "allow", "--", "run", "--env", "kept"]),
    {
      kind: "add",
      name: "x",
      command: "run",
      args: ["--env", "kept"],
      tokenEnv: null,
      options: { env: ["A=1", "TOKEN"], headers: [], cwd: "/w", onDemand: true, project: true, timeout: 30, approval: "allow" },
    },
  );
  assert.deepEqual(parseMcpArgs(["add", "h", "--url", "https://x.test/mcp", "--header", "X-Team=blue", "--token"]), {
    kind: "add",
    name: "h",
    url: "https://x.test/mcp",
    token: true,
    options: { env: [], headers: ["X-Team=blue"], cwd: null, onDemand: false, project: false, timeout: null, approval: null },
  });
});

test("a bad timeout, approval, or a flag with no value is refused", () => {
  const message = (words: string[]): string => {
    const parsed = parseMcpArgs(words);
    assert.equal(parsed.kind, "error");
    return parsed.kind === "error" ? parsed.message : "";
  };
  assert.match(message(["add", "x", "--timeout", "0", "--", "run"]), /1 to 3600/);
  assert.match(message(["add", "x", "--timeout", "soon", "--", "run"]), /whole number/);
  assert.match(message(["add", "x", "--approval", "never", "--", "run"]), /ask or allow/);
  assert.match(message(["add", "x", "--env", "--", "run"]), /--env needs a value/);
  assert.match(message(["add", "x", "--cwd"]), /--cwd needs a value/);
});

test("test --catalog, edit, and import read their words", () => {
  assert.deepEqual(parseMcpArgs(["test", "--catalog", "github", "--input", "a=b", "--name", "gh"]), {
    kind: "testCatalog",
    id: "github",
    name: "gh",
    inputs: { a: "b" },
  });
  assert.deepEqual(parseMcpArgs(["edit", "git"]), { kind: "edit", name: "git", project: false });
  assert.deepEqual(parseMcpArgs(["edit", "git", "--project"]), { kind: "edit", name: "git", project: true });
  assert.deepEqual(parseMcpArgs(["import"]), { kind: "import", from: null, all: false, project: false });
  assert.deepEqual(parseMcpArgs(["import", "--from", "cursor", "--all", "--project"]), { kind: "import", from: "cursor", all: true, project: true });
  assert.deepEqual(parseMcpArgs(["import", "--from", "./servers.json"]), { kind: "import", from: "./servers.json", all: false, project: false });
});

test("import refuses what it does not know", () => {
  const message = (words: string[]): string => {
    const parsed = parseMcpArgs(words);
    assert.equal(parsed.kind, "error");
    return parsed.kind === "error" ? parsed.message : "";
  };
  assert.match(message(["import", "--from"]), /--from needs/);
  assert.match(message(["import", "cursor"]), /unexpected cursor/);
  assert.match(message(["import", "--wat"]), /unknown option --wat/);
  assert.match(message(["edit"]), /usage: golem mcp edit <name>/);
  assert.match(message(["edit", "git", "--all"]), /unknown option --all/);
});

test("login and logout take one name", () => {
  assert.deepEqual(parseMcpArgs(["login", "linear"]), { kind: "login", name: "linear" });
  assert.deepEqual(parseMcpArgs(["logout", "linear"]), { kind: "logout", name: "linear" });
  assert.equal(parseMcpArgs(["login"]).kind, "error");
  assert.equal(parseMcpArgs(["logout", "a", "b"]).kind, "error");
});

test("the list says needs sign-in", () => {
  const text = formatMcpList([{ name: "linear", state: "needs_auth", command: "https://mcp.linear.app/mcp" }]);
  assert.match(text, /linear\s+needs sign-in/);
});

type Login = { client: GolemClient; send(done: McpLoginDone): void; out: string[]; errors: string[]; opened: string[]; deps: LoginDeps };

function loginFixture(timeoutMs = 1000, toolCount = 12): Login {
  const listeners = new Set<(done: McpLoginDone) => void>();
  const out: string[] = [];
  const errors: string[] = [];
  const opened: string[] = [];
  const client = {
    onMcpLoginDone: (listener: (done: McpLoginDone) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mcpLogin: async (name: string) => ({ name, authorize_url: "https://auth.example/authorize" }),
    mcpTools: async (name: string) => ({ name, tools: Array.from({ length: toolCount }, (_, index) => ({ name: `t${index}`, description: "" })) }),
  } as unknown as GolemClient;
  return {
    client,
    send: (done) => listeners.forEach((listener) => listener(done)),
    out,
    errors,
    opened,
    deps: { open: (url) => opened.push(url), write: (line) => out.push(line), error: (line) => errors.push(line), timeoutMs },
  };
}

test("login prints and opens the address, waits, and exits 0 when signed in", async () => {
  const fixture = loginFixture();
  const running = runMcpLogin(fixture.client, "linear", fixture.deps);
  await new Promise((resolve) => setTimeout(resolve, 10));
  fixture.send({ name: "other", ok: false, error: "not this one" });
  fixture.send({ name: "linear", ok: true });
  assert.equal(await running, 0);
  assert.deepEqual(fixture.opened, ["https://auth.example/authorize"]);
  assert.ok(fixture.out.includes("https://auth.example/authorize"));
  assert.equal(fixture.out.at(-1), "Signed in to linear · 12 tools");
  assert.deepEqual(fixture.errors, []);
});

test("login exits 1 with the reason when the sign-in fails", async () => {
  const fixture = loginFixture();
  const running = runMcpLogin(fixture.client, "linear", fixture.deps);
  await new Promise((resolve) => setTimeout(resolve, 10));
  fixture.send({ name: "linear", ok: false, error: "the browser refused" });
  assert.equal(await running, 1);
  assert.deepEqual(fixture.errors, ["the browser refused"]);
});

test("login exits 1 when nobody answers in time", async () => {
  const fixture = loginFixture(20);
  assert.equal(await runMcpLogin(fixture.client, "linear", fixture.deps), 1);
  assert.match(fixture.errors[0] ?? "", /no sign-in to linear/);
});
