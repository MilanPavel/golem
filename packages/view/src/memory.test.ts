import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryItem } from "@golem/client";

import { groupMemories, memoryKeyHints, memoryLabel, memoryStateText, memoryUsableNote } from "./memory.ts";

const base: MemoryItem = {
  id: "m_1",
  scope: "you",
  author: "you",
  state: "kept",
  title: "I prefer pnpm",
  text: "I prefer pnpm",
  created_at: "2026-11-19T10:00:00Z",
  updated_at: "2026-11-19T10:00:00Z",
};

const source = { path: "a.py", sha256: "x", size: 1, mtime_ns: 1, checked_at: "2026-11-19T10:00:00Z" };

test("rows are grouped by scope in a fixed order, and empty scopes are left out", () => {
  const rows: MemoryItem[] = [
    { ...base, id: "m_h", scope: "history" },
    { ...base, id: "m_p", scope: "project" },
    { ...base, id: "m_y" },
    { ...base, id: "m_y2" },
  ];
  const groups = groupMemories(rows);
  assert.deepEqual(groups.map((group) => group.title), ["You", "This project", "History"]);
  assert.deepEqual(groups[0]?.items.map((item) => item.id), ["m_y", "m_y2"]);
  assert.deepEqual(groupMemories([{ ...base, scope: "project" }]).map((group) => group.scope), ["project"]);
  assert.deepEqual(groupMemories([]), []);
});

test("a label says who wrote the memory and who kept it", () => {
  assert.equal(memoryLabel(base), "you said");
  const lead: MemoryItem = { ...base, author: "lead", state: "proposed" };
  assert.equal(memoryLabel(lead), "golem proposed");
  assert.equal(memoryLabel({ ...lead, state: "kept", kept_by: "you" }), "golem proposed · you kept");
  assert.equal(memoryLabel({ ...lead, state: "kept", kept_by: "auto" }), "golem proposed · kept automatically");
});

test("a helper's label names the agent and counts its files", () => {
  const helper: MemoryItem = { ...base, author: "helper", agent: "explorer", sources: [source, source, source] };
  assert.equal(memoryLabel(helper), "an explorer · 3 files");
  assert.equal(memoryLabel({ ...helper, sources: [source] }), "an explorer · 1 file");
  assert.equal(memoryLabel({ ...helper, agent: "reviewer", sources: [] }), "a reviewer");
  assert.equal(memoryLabel({ ...helper, agent: null, sources: undefined }), "a helper");
  assert.equal(memoryLabel({ ...helper, kept_by: "you" }), "an explorer · 3 files · you kept");
});

test("the state text names each thing that is true of the row", () => {
  assert.equal(memoryStateText(base), "");
  assert.equal(memoryStateText({ ...base, always: true }), "in every chat");
  assert.equal(memoryStateText({ ...base, state: "stale" }), "may be out of date");
  assert.equal(memoryStateText({ ...base, state: "proposed" }), "waiting for you");
  assert.equal(memoryStateText({ ...base, privacy: "local" }), "local models only");
  assert.equal(
    memoryStateText({ ...base, state: "stale", always: true, privacy: "local" }),
    "may be out of date · in every chat · local models only",
  );
});

test("a local row says it is not used when there is no local model, and a cloud row never does", () => {
  const local: MemoryItem = { ...base, privacy: "local" };
  assert.equal(memoryUsableNote({ ...local, usable: false }), "not used: no local model is set up");
  assert.equal(memoryUsableNote({ ...local, usable: true }), null);
  assert.equal(memoryUsableNote(local), null);
  // Cloud models only: a chat row stays usable, so it has no note.
  assert.equal(memoryUsableNote({ ...base, privacy: "chat", usable: null }), null);
  assert.equal(memoryUsableNote(base), null);
});

test("the key hints depend on the row", () => {
  assert.equal(memoryKeyHints(null), "esc close");
  assert.match(memoryKeyHints({ ...base, state: "proposed" }), /^k keep/);
  assert.match(memoryKeyHints(base), /^e edit/);
});
