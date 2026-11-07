import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMcpArgs } from "./mcp-command.ts";

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
