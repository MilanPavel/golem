import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_PREFS, loadPrefs, mergePrefs, parsePrefs, prefsPath, savePref } from "./prefs.ts";

test("prefs remember times and todos, and keep other keys", () => {
  assert.deepEqual(parsePrefs(""), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("{"), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('{"times":false,"theme":"light"}'), { times: false, todos: true, thinking: true });
  assert.deepEqual(parsePrefs('{"times":true,"todos":false}'), { times: true, todos: false, thinking: true });
  assert.equal(mergePrefs('{"theme":"light"}', "times", true), '{\n  "theme": "light",\n  "times": true\n}\n');
  assert.equal(prefsPath({ GOLEM_HOME: "/tmp/golem-home" }, "/home/me"), "/tmp/golem-home/tui.json");
});

test("a missing prefs file has the defaults, and saves round-trip one key at a time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "golem-prefs-"));
  const file = join(dir, "tui.json");
  assert.deepEqual(await loadPrefs(file), DEFAULT_PREFS);
  await savePref(file, "times", true);
  await savePref(file, "todos", false);
  assert.equal(await readFile(file, "utf8"), '{\n  "times": true,\n  "todos": false\n}\n');
  assert.deepEqual(await loadPrefs(file), { times: true, todos: false, thinking: true });
});

test("thinking is shown unless the file says false, and the choice is saved", async () => {
  assert.equal(parsePrefs('{"times":true}').thinking, true);
  assert.equal(parsePrefs('{"thinking":false}').thinking, false);
  const dir = await mkdtemp(join(tmpdir(), "golem-prefs-"));
  const file = join(dir, "tui.json");
  await savePref(file, "thinking", false);
  assert.equal(await readFile(file, "utf8"), '{\n  "thinking": false\n}\n');
  assert.deepEqual(await loadPrefs(file), { ...DEFAULT_PREFS, thinking: false });
});
