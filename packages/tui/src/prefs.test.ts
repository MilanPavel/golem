import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadPrefs, mergePrefs, parsePrefs, prefsPath, saveTimes } from "./prefs.ts";

test("prefs remember times and keep other keys", () => {
  assert.deepEqual(parsePrefs(""), { times: false });
  assert.deepEqual(parsePrefs("{"), { times: false });
  assert.deepEqual(parsePrefs('{"times":false,"theme":"light"}'), { times: false });
  assert.deepEqual(parsePrefs('{"times":true}'), { times: true });
  assert.equal(mergePrefs('{"theme":"light"}', true), '{\n  "theme": "light",\n  "times": true\n}\n');
  assert.equal(prefsPath({ GOLEM_HOME: "/tmp/golem-home" }, "/home/me"), "/tmp/golem-home/tui.json");
});

test("a missing prefs file is off, and a save round-trips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "golem-prefs-"));
  const file = join(dir, "tui.json");
  assert.deepEqual(await loadPrefs(file), { times: false });
  await saveTimes(file, true);
  assert.equal(await readFile(file, "utf8"), '{\n  "times": true\n}\n');
  assert.deepEqual(await loadPrefs(file), { times: true });
});
