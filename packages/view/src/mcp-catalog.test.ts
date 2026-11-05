import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogEntry, MCP_CATALOG, mcpNameError, otherSpec, shellQuote, splitCommandLine } from "./mcp-catalog.ts";

function entry(id: string) {
  const found = catalogEntry(id);
  assert.ok(found);
  return found;
}

test("the list has filesystem, github, fetch, and other, in that order", () => {
  assert.deepEqual(MCP_CATALOG.map((item) => item.id), ["filesystem", "github", "fetch", "other"]);
  assert.equal(catalogEntry("nope"), null);
  assert.deepEqual(MCP_CATALOG.filter((item) => item.needsToken).map((item) => item.id), ["github"]);
});

test("filesystem is scoped to the folder it is given", () => {
  const item = entry("filesystem");
  assert.deepEqual(item.params?.("/Users/me/app"), {
    name: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/app"],
  });
  assert.ok(item.label("/Users/me/app").includes("/Users/me/app"));
  assert.equal(
    item.cliCommand("/Users/me/app"),
    "golem mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem /Users/me/app",
  );
  assert.ok(item.cliCommand(null).endsWith("server-filesystem <folder>"));
  assert.ok(item.cliCommand("/Users/me/my app").endsWith("'/Users/me/my app'"));
});

test("github is a URL that needs a token, fetch is a command", () => {
  assert.deepEqual(entry("github").params?.("/x"), { name: "github", url: "https://api.githubcopilot.com/mcp/" });
  assert.equal(entry("github").cliCommand("/x"), "golem mcp add github --url https://api.githubcopilot.com/mcp/ --token");
  assert.deepEqual(entry("fetch").params?.("/x"), { name: "fetch", command: "uvx", args: ["mcp-server-fetch"] });
  assert.equal(entry("fetch").cliCommand("/x"), "golem mcp add fetch -- uvx mcp-server-fetch");
  assert.equal(entry("other").params, null);
});

test("a name follows the daemon's rule", () => {
  for (const good of ["a", "git-hub", "A1", "x".repeat(32)]) {
    assert.equal(mcpNameError(good), null, good);
  }
  for (const bad of ["", "-a", "a b", "a_b", "x".repeat(33), "é"]) {
    assert.notEqual(mcpNameError(bad), null, bad);
  }
});

test("a command line splits on spaces and keeps quotes together", () => {
  assert.deepEqual(splitCommandLine("npx -y  pkg"), ["npx", "-y", "pkg"]);
  assert.deepEqual(splitCommandLine(`run "my dir" 'a b' c"d e"f`), ["run", "my dir", "a b", "cd ef"]);
  assert.deepEqual(splitCommandLine('x "" y'), ["x", "", "y"]);
  assert.deepEqual(splitCommandLine("   "), []);
});

test("other takes a command or a URL", () => {
  assert.deepEqual(otherSpec("s", "uvx tool --x 'a b'"), { spec: { name: "s", command: "uvx", args: ["tool", "--x", "a b"] } });
  assert.deepEqual(otherSpec("s", " https://x.example/mcp "), { spec: { name: "s", url: "https://x.example/mcp" } });
  assert.deepEqual(otherSpec("s", "http://localhost:8000/mcp"), { spec: { name: "s", url: "http://localhost:8000/mcp" } });
  assert.ok("error" in otherSpec("s", "  "));
  assert.ok("error" in otherSpec("s", "https://x y"));
  assert.ok("error" in otherSpec("s", 'run "oops'));
});

test("shell quoting leaves plain words and quotes the rest", () => {
  assert.equal(shellQuote("/a/b-c_d.e"), "/a/b-c_d.e");
  assert.equal(shellQuote("a b"), "'a b'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  assert.equal(shellQuote("$HOME"), "'$HOME'");
  assert.equal(shellQuote(""), "''");
});
