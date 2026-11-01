import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readStartError } from "./start-error.ts";

function home(content: string | null): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "golem-start-error-"));
  if (content !== null) {
    mkdirSync(path.join(dir, "run"));
    writeFileSync(path.join(dir, "run", "last-error"), content);
  }
  return dir;
}

test("the reason and the next step come from the two lines the daemon wrote", () => {
  const dir = home("your data is from golem 0.6, this is 0.4\nbrew upgrade golem\n");
  try {
    assert.deepEqual(readStartError(dir), {
      reason: "your data is from golem 0.6, this is 0.4",
      next: "brew upgrade golem",
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a missing or empty file means no start error", () => {
  for (const content of [null, "", "\n\n"]) {
    const dir = home(content);
    try {
      assert.equal(readStartError(dir), null);
    } finally {
      rmSync(dir, { recursive: true });
    }
  }
});

test("a reason with no next step still reads", () => {
  const dir = home("the socket path is too long");
  try {
    assert.deepEqual(readStartError(dir), { reason: "the socket path is too long", next: "" });
  } finally {
    rmSync(dir, { recursive: true });
  }
});
