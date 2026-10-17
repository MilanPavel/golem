import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  appendHistory,
  browseHistory,
  createHistory,
  decodeHistory,
  encodeHistory,
  HISTORY_LIMIT,
  historyPath,
  leaveHistory,
  recallOrder,
  sessionEntries,
  type HistoryCursor,
} from "./history.ts";

test("session messages come first, then older lines from the file", () => {
  assert.deepEqual(
    sessionEntries([
      { role: "assistant", text: "answer" },
      { role: "user", text: "old" },
      { role: "user", text: "" },
      { role: "user", text: "new" },
    ]),
    ["old", "new"],
  );
  assert.deepEqual(recallOrder(["old", "new"], ["ancient", "old", "other"]), ["new", "old", "other", "ancient"]);
});

test("up recalls newest first, and an edit is not written back", () => {
  const entries = ["new", "old"];
  const first = browseHistory(null, "older", entries, "");
  assert.equal(first.text, "new");
  assert.equal(first.cursor?.index, 0);

  const edited = browseHistory(first.cursor, "older", entries, "new edited");
  assert.equal(edited.text, "old");
  assert.deepEqual(entries, ["new", "old"]);

  const back = browseHistory(edited.cursor, "newer", entries, "old tweaked");
  assert.equal(back.text, "new");
  const restored = browseHistory(back.cursor, "newer", entries, "still new");
  assert.deepEqual(restored, { cursor: null, text: "" });
});

test("esc restores the draft from before browsing, and up at the end stays", () => {
  const cursor: HistoryCursor = { saved: "kept", index: 0 };
  assert.deepEqual(leaveHistory(cursor, "changed"), { cursor: null, text: "kept" });
  assert.deepEqual(leaveHistory(null, "plain"), { cursor: null, text: "plain" });

  const stayed = browseHistory({ saved: "", index: 0 }, "older", ["only"], "only");
  assert.equal(stayed.cursor?.index, 0);
  assert.equal(stayed.text, "only");
  assert.deepEqual(browseHistory(null, "older", [], "draft"), { cursor: null, text: "draft" });
  assert.deepEqual(browseHistory(null, "newer", ["a"], "draft"), { cursor: null, text: "draft" });
});

test("the history file is one json string per line, capped at 1000", () => {
  assert.equal(encodeHistory(["a", "b\nc"]), '"a"\n"b\\nc"\n');
  assert.deepEqual(decodeHistory('"a"\nnot json\n""\n"b\\nc"\n'), ["a", "b\nc"]);
  const same = ["same"];
  assert.equal(appendHistory(same, "same"), same);
  assert.equal(appendHistory(same, ""), same);
  const full = Array.from({ length: HISTORY_LIMIT }, (_, index) => `m${index}`);
  const added = appendHistory(full, "newest");
  assert.equal(added.length, HISTORY_LIMIT);
  assert.equal(added[0], "m1");
  assert.equal(added.at(-1), "newest");
});

test("the history path follows GOLEM_HOME", () => {
  assert.equal(historyPath({ GOLEM_HOME: "/tmp/golem-home" }, "/home/me"), "/tmp/golem-home/history");
  assert.equal(historyPath({ GOLEM_HOME: "  " }, "/home/me"), "/home/me/.golem/history");
  assert.equal(historyPath({ GOLEM_HOME: "~/golem" }, "/home/me"), "/home/me/golem/history");
});

test("a new store reads lines an earlier one remembered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "golem-history-"));
  const file = join(dir, "history");
  try {
    const first = createHistory(file);
    await first.load();
    first.remember("one");
    first.remember("two");
    first.remember("two");
    await first.settled();
    assert.equal(await readFile(file, "utf8"), '"one"\n"two"\n');

    const second = createHistory(file);
    const loading = second.load();
    second.remember("three");
    await loading;
    await second.settled();
    assert.deepEqual(second.snapshot(), ["one", "two", "three"]);

    const restarted = createHistory(file);
    await restarted.load();
    assert.deepEqual(restarted.snapshot(), ["one", "two", "three"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
