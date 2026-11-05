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
