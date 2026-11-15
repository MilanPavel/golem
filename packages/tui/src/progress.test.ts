import assert from "node:assert/strict";
import { test } from "node:test";

import { assistantChars, elapsedSeconds, meterLine, meterPhase, shuttle, writingNow } from "./progress.ts";

test("the meter is hidden until a run is busy", () => {
  assert.equal(meterPhase(false, 0), null);
  assert.equal(meterPhase(true, 0), "thinking");
  assert.equal(meterPhase(true, 12), "writing");
});

test("writing names the characters and the seconds, thinking does not invent a percent", () => {
  const thinking = meterLine("thinking", 0, 0, 0, 40);
  assert.match(thinking, /^thinking {2}█/);
  assert.doesNotMatch(thinking, /%/);
  const writing = meterLine("writing", 1204, 4, 1, 48);
  assert.match(writing, /^writing · 1,204 chars · 0m 04s {2}/);
  assert.notEqual(shuttle(0, 10), shuttle(1, 10));
});

test("while a local server starts, the meter says so instead of thinking", () => {
  assert.match(meterLine("thinking", 0, 0, 0, 40, "ollama"), /^starting ollama {2}█/);
  assert.match(meterLine("writing", 12, 1, 0, 48, "ollama"), /^writing · 12 chars/);
});

test("while a chat call waits for the local model, the meter says so", () => {
  assert.match(meterLine("thinking", 0, 0, 0, 40, "ollama", true), /^waiting for the local model {2}█/);
  assert.match(meterLine("thinking", 0, 0, 0, 40, null, false), /^thinking/);
});

test("elapsed seconds come from the run timestamp", () => {
  assert.equal(elapsedSeconds(null, 1_000), 0);
  assert.equal(elapsedSeconds("not-a-date", 1_000), 0);
  assert.equal(elapsedSeconds("2026-10-07T00:00:00.000Z", Date.parse("2026-10-07T00:00:04.200Z")), 4);
});

test("character count is the latest assistant message", () => {
  assert.equal(
    assistantChars([
      { id: "u", role: "user", text: "hello", streaming: false },
      { id: "a", role: "assistant", text: "Hi", streaming: true },
    ]),
    2,
  );
  assert.equal(assistantChars([]), 0);
});

test("a file being written takes the meter text and the writing phase", () => {
  assert.equal(meterPhase(true, 0, false, true), "writing");
  assert.equal(meterPhase(true, 0, false, false), "thinking");
  assert.match(meterLine("writing", 0, 4, 0, 60, null, false, "writing a.py · 6 lines · 4 s"), /^writing a\.py · 6 lines · 4 s {2}█/);
  assert.equal(writingNow([{ id: "a", role: "assistant", text: "", streaming: true, writing: { name: "write_file", path: null, lines: 1, chars: 3 } }])?.writing.lines, 1);
  assert.equal(writingNow([]), null);
});
