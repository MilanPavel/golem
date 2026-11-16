import assert from "node:assert/strict";
import { test } from "node:test";

import { noChanges, type ChangesState, type ChatMessage, type TurnChanges } from "@golem/view";
import { layoutMessages, type Span, type TranscriptOptions } from "./layout-chat.ts";
import { changedLabel, fitSegments, STATUS_PRIORITY, statusSegments } from "./status-label.ts";

function textOf(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join("");
}

function message(id: string, role: ChatMessage["role"], text: string, runId?: string): ChatMessage {
  return { id, role, text, streaming: false, ...(runId === undefined ? {} : { runId }) };
}

const editRun: ChatMessage[] = [message("u1", "user", "fix it"), message("a1", "assistant", "done", "r1")];
const editChanges: ChangesState = {
  turns: [
    {
      runId: "r1",
      reverted: false,
      revertIds: [],
      files: [
        { path: "a.py", status: "modified", added: 40, removed: 4, changeIds: ["c1"] },
        { path: "b.py", status: "created", added: 3, removed: 0, changeIds: ["c2"] },
        { path: "c.py", status: "created", added: 0, removed: 0, changeIds: ["c3"] },
      ],
    },
  ],
  revertTurns: {},
};

function rows(messages: ChatMessage[], columns: number, extra: Partial<TranscriptOptions>): string[] {
  return layoutMessages(messages, columns, { times: false, now: 0, ...extra }).map((line) => textOf(line.spans));
}

test("a finished edit turn ends in one summary row that names the commands that exist", () => {
  const options = { changes: editChanges, commands: ["/changes", "/undo"] };
  assert.equal(
    rows(editRun, 100, options).at(-1),
    "─ 3 files +43 −4 · /changes to review · /undo takes this turn back ─",
  );
  assert.equal(rows(editRun, 60, options).at(-1), "─ 3 files +43 −4 · /changes ─");
});

test("the summary row leaves out a command that does not exist yet", () => {
  const only = rows(editRun, 100, { changes: editChanges, commands: ["/changes"] });
  assert.equal(only.at(-1), "─ 3 files +43 −4 · /changes to review ─");
  assert.equal(rows(editRun, 100, { changes: editChanges, commands: [] }).at(-1), "─ 3 files +43 −4 ─");
});

test("no summary row without changes or while the run is still going", () => {
  assert.equal(rows(editRun, 100, { changes: noChanges, commands: ["/changes"] }).at(-1), "done");
  assert.equal(rows(editRun, 100, { commands: ["/changes"] }).at(-1), "done");
  assert.equal(rows(editRun, 100, { changes: editChanges, liveRunId: "r1", commands: ["/changes"] }).at(-1), "done");
});

test("the summary row comes after the last reply of the run only", () => {
  const messages = [...editRun, message("a2", "assistant", "more", "r1")];
  const out = rows(messages, 100, { changes: editChanges, commands: ["/changes"] });
  assert.equal(out.filter((line) => line.startsWith("─ ")).length, 1);
  assert.match(out.at(-1) ?? "", /^─ 3 files/);
});

test("an undone turn says the files were put back", () => {
  const undone: ChangesState = { ...editChanges, turns: [{ ...(editChanges.turns[0] as TurnChanges), reverted: true }] };
  assert.equal(
    rows(editRun, 100, { changes: undone, commands: ["/changes", "/undo"] }).at(-1),
    "─ undone: 3 files put back ─",
  );
});

test("the changed segment hides at zero, counts files, and leaves before the model", () => {
  const input = { connection: "connected", title: "Trip", model: "qwen", folder: "~/repos/golem", messageCount: null, uptimeSeconds: null };
  assert.equal(statusSegments(input).find((part) => part.id === "changed")?.text, "");
  assert.equal(changedLabel(1), "Δ 1 file");
  const segments = statusSegments({ ...input, changedFiles: 3 });
  assert.equal(segments.find((part) => part.id === "changed")?.text, "Δ 3 files");
  assert.ok(STATUS_PRIORITY.changed < STATUS_PRIORITY.model);
  assert.ok(STATUS_PRIORITY.changed > STATUS_PRIORITY.folder && STATUS_PRIORITY.changed < STATUS_PRIORITY.skills);
  const ids = (columns: number) => fitSegments(segments, columns).map((part) => part.id);
  assert.ok(ids(200).includes("changed"));
  const narrow = ids(30);
  assert.ok(!narrow.includes("changed"));
  assert.ok(narrow.includes("model"));
});
