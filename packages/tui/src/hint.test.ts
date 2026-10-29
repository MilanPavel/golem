import assert from "node:assert/strict";
import { test } from "node:test";

import { bannerRow, HINT_MS, hintFor, liveHint } from "./hint.ts";

test("a hint shows until its time is up", () => {
  const hint = hintFor("copied", 1_000);
  assert.deepEqual(hint, { text: "copied", until: 1_000 + HINT_MS });
  assert.equal(liveHint(hint, 1_000 + HINT_MS - 1), hint);
  assert.equal(liveHint(hint, 1_000 + HINT_MS), null);
  assert.equal(hintFor("Ctrl-C again to exit", 0, 2_000).until, 2_000);
  assert.equal(liveHint(null, 0), null);
});

test("a hint alone sits at the end of the row", () => {
  assert.deepEqual(bannerRow(null, "copied", 20), { left: "", gap: " ".repeat(14), right: "copied" });
});

test("the banner and a hint share the row, the banner on the left", () => {
  const row = bannerRow("download failed", "copied", 30);
  assert.deepEqual(row, { left: "download failed", gap: " ".repeat(9), right: "copied" });
  assert.equal(row.left.length + row.gap.length + row.right.length, 30);
});

test("when both do not fit, the hint is cut first, then left out", () => {
  assert.deepEqual(bannerRow("download failed", "exported to ~/x.md", 28), {
    left: "download failed",
    gap: "  ",
    right: "exported t…",
  });
  assert.deepEqual(bannerRow("download failed: no space", "exported to ~/x.md", 30), {
    left: "download failed: no space",
    gap: "",
    right: "",
  });
  assert.deepEqual(bannerRow("abcdef", null, 4), { left: "abc…", gap: "", right: "" });
});
