import assert from "node:assert/strict";
import { test } from "node:test";

import { applyParams, candidateNotes, candidateTarget, importItems, initialPicks, missingRefsOf, scanSummary, type ImportSource } from "./mcp-import.ts";

const SOURCES: ImportSource[] = [
  {
    id: "cursor",
    label: "Cursor",
    path: "/Users/me/.cursor/mcp.json",
    candidates: [
      { key: "a", name: "git", original_name: "git", scope: "user", config: { command: "uvx", args: ["mcp-server-git"] } },
      { key: "b", name: "gh-2", original_name: "gh", scope: "user", clash: true, config: { url: "https://x.example/mcp" }, secret_refs: ["mcp/gh-2"], missing_refs: ["mcp/gh-2"] },
      { key: "c", name: "old", original_name: "old", scope: "project", already_same: true, config: { command: "old" } },
    ],
  },
  { id: "vscode", label: "VS Code", error: "not valid JSON" },
];

test("items follow the sources, and say what each runs", () => {
  const items = importItems(SOURCES);
  assert.deepEqual(items.map((item) => item.key), ["a", "b", "c"]);
  assert.equal(candidateTarget(items[0]!.candidate), "uvx mcp-server-git");
  assert.equal(candidateTarget(items[1]!.candidate), "https://x.example/mcp");
});

test("notes say already added, the new name, and the project", () => {
  const items = importItems(SOURCES);
  assert.deepEqual(candidateNotes(items[0]!.candidate), []);
  assert.deepEqual(candidateNotes(items[1]!.candidate), ["will be named gh-2"]);
  assert.deepEqual(candidateNotes(items[2]!.candidate), ["already added", "this project"]);
});

test("every server golem lacks starts picked", () => {
  assert.deepEqual([...initialPicks(importItems(SOURCES))], ["a", "b"]);
});

test("a ref is asked for once, and only for a picked server", () => {
  const items = importItems(SOURCES);
  assert.deepEqual(missingRefsOf(items, new Set(["a", "b"])), ["mcp.gh-2".replace(".", "/")]);
  assert.deepEqual(missingRefsOf(items, new Set(["a"])), []);
});

test("the params carry picks by key with the typed name, and only the secrets typed", () => {
  const items = importItems(SOURCES);
  const out = applyParams("scan1", items, new Set(["a", "b"]), { a: "my-git" }, { "mcp/gh-2": "tok" });
  assert.deepEqual(out, {
    scan_id: "scan1",
    picks: [
      { key: "a", name: "my-git", scope: "user" },
      { key: "b", name: "gh-2", scope: "user" },
    ],
    secrets: { "mcp/gh-2": "tok" },
  });
  const later = applyParams("scan1", items, new Set(["b"]), {}, { "mcp/gh-2": "" });
  assert.ok(!("error" in later));
  assert.deepEqual(later.secrets, {});
});

test("nothing picked, a bad name, and a repeated name each say so", () => {
  const items = importItems(SOURCES);
  assert.deepEqual(applyParams("s", items, new Set(), {}, {}), { error: "Pick at least one server." });
  const bad = applyParams("s", items, new Set(["a"]), { a: "no way" }, {});
  assert.ok("error" in bad && bad.error.startsWith("git: Use letters"));
  assert.deepEqual(applyParams("s", items, new Set(["a", "b"]), { a: "x", b: "x" }, {}), { error: "Two servers would be named x. Rename one." });
});

test("the summary counts servers and the places that have some", () => {
  assert.equal(scanSummary(SOURCES), "3 servers in 1 place");
  assert.equal(scanSummary([]), "0 servers in 0 places");
});
