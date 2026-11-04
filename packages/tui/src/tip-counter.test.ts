import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { peekTip, takeTip, tipCounterPath } from "./tip-counter.ts";

test("each new session takes the next count, and a peek doesn't move it", () => {
  const root = mkdtempSync(path.join(tmpdir(), "golem-tip-"));
  try {
    const file = tipCounterPath({ GOLEM_HOME: path.join(root, "home") }, root);
    assert.equal(peekTip(file), 0);
    assert.equal(takeTip(file), 0);
    assert.equal(peekTip(file), 1);
    assert.equal(takeTip(file), 1);
    assert.equal(takeTip(file), 2);
    assert.equal(readFileSync(file, "utf8"), "3\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
