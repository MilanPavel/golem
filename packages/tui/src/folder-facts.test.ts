import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { folderFacts } from "./folder-facts.ts";

test("a folder inside a git repo, an empty one, and one with files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "golem-facts-"));
  try {
    const repo = path.join(root, "repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    mkdirSync(path.join(repo, "src"));
    writeFileSync(path.join(repo, "src", "main.ts"), "");
    assert.deepEqual(folderFacts(path.join(repo, "src")), { git: true, empty: false });
    const empty = path.join(root, "empty");
    mkdirSync(empty);
    writeFileSync(path.join(empty, ".DS_Store"), "");
    assert.equal(folderFacts(empty).empty, true);
    const files = path.join(root, "files");
    mkdirSync(files);
    writeFileSync(path.join(files, "notes.txt"), "");
    assert.equal(folderFacts(files).empty, false);
    assert.equal(folderFacts(path.join(root, "missing")).empty, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
