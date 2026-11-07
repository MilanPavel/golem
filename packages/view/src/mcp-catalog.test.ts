import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cliCommand,
  entryAvailable,
  entryNote,
  entryParams,
  findEntry,
  inputDefault,
  inputError,
  mcpNameError,
  otherSpec,
  shellQuote,
  splitCommandLine,
  type McpCatalogEntry,
} from "./mcp-catalog.ts";

const FILESYSTEM: McpCatalogEntry = {
  id: "filesystem",
  name: "filesystem",
  title: "Filesystem",
  description: "Read and write files in a folder.",
  category: "files",
  homepage: "https://example.com",
  runtime: "npx",
  auth: "none",
  inputs: [{ id: "folder", kind: "path", label: "Folder", default: "{folder}", required: true }],
};

const GITHUB: McpCatalogEntry = {
  id: "github",
  name: "github",
  title: "GitHub",
  description: "Repos, issues, and pull requests.",
  category: "code",
  homepage: "https://example.com",
  runtime: "url",
  auth: "token",
  inputs: [{ id: "token", kind: "secret", label: "GitHub token", required: true }],
};

const SIGN_IN: McpCatalogEntry = { ...GITHUB, id: "linear", auth: "oauth", available: false, reason: "needs sign-in" };

test("an entry is found by id, and the daemon says when it is not available", () => {
  assert.equal(findEntry([FILESYSTEM, GITHUB], "github"), GITHUB);
  assert.equal(findEntry([FILESYSTEM], "nope"), null);
  assert.equal(findEntry([FILESYSTEM], null), null);
  assert.equal(entryAvailable(FILESYSTEM), true);
  assert.equal(entryAvailable(SIGN_IN), false);
  assert.equal(entryNote(SIGN_IN), "Repos, issues, and pull requests. needs sign-in");
  assert.equal(entryNote({ ...FILESYSTEM, added: true }), "Read and write files in a folder. Already added.");
});

test("a path input starts at the session folder", () => {
  const folder = FILESYSTEM.inputs?.[0];
  assert.ok(folder);
  assert.equal(inputDefault(folder, "/Users/me/app"), "/Users/me/app");
  assert.equal(inputDefault({ ...folder, default: null }, "/x"), "");
});

test("an input is checked before it is sent", () => {
  const [folder] = FILESYSTEM.inputs ?? [];
  assert.ok(folder);
  assert.equal(inputError(folder, "/a"), null);
  assert.equal(inputError(folder, "  "), "Folder is needed.");
  assert.equal(inputError({ ...folder, required: false }, ""), null);
  const choice = { ...folder, kind: "choice" as const, choices: ["a", "b"] };
  assert.equal(inputError(choice, "a"), null);
  assert.equal(inputError(choice, "c"), "Pick one of: a, b.");
});

test("text inputs go in inputs and secrets go in secrets, keyed by input id", () => {
  assert.deepEqual(entryParams(FILESYSTEM, { folder: " /a " }), {
    name: "filesystem",
    catalog_id: "filesystem",
    inputs: { folder: "/a" },
    secrets: {},
  });
  assert.deepEqual(entryParams(GITHUB, { token: "ghp_x" }), {
    name: "github",
    catalog_id: "github",
    inputs: {},
    secrets: { token: "ghp_x" },
  });
  assert.deepEqual(entryParams(GITHUB, {}), { name: "github", catalog_id: "github", inputs: {}, secrets: {} });
});

test("the command line for an entry asks for what has no default", () => {
  assert.equal(cliCommand(FILESYSTEM), "golem mcp add --catalog filesystem");
  assert.equal(cliCommand(GITHUB), "golem mcp add --catalog github");
  assert.equal(
    cliCommand({ ...FILESYSTEM, inputs: [{ id: "repo", kind: "path", label: "Repository", required: true }] }),
    "golem mcp add --catalog filesystem --input repo=<repository>",
  );
  assert.equal(cliCommand(null), "golem mcp add <name> -- <command…>");
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
  assert.deepEqual(otherSpec("s", "npx -y pkg"), { spec: { name: "s", command: "npx", args: ["-y", "pkg"] } });
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
