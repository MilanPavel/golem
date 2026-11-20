import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryItem } from "@golem/client";

import type { Press } from "./keys.ts";
import {
  closedMemoryManager,
  emptyMemoryList,
  layoutMemoryManager,
  memoryEdited,
  memoryExportFile,
  memoryIsOff,
  memoryListParams,
  memoryManagerKeyOf,
  memoryMark,
  memoryToDelete,
  memoryUseLine,
  openMemoryManager,
  pressMemoryManager,
  projectFolderOf,
  type MemoryList,
  type MemoryManagerKey,
  type MemoryManagerState,
} from "./memory-manager.ts";

const base = { created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z" };
const pnpm: MemoryItem = { ...base, id: "m_1", scope: "you", author: "you", state: "kept", kept_by: "you", title: "I prefer pnpm", text: "I prefer pnpm", always: true };
const retry: MemoryItem = {
  ...base,
  id: "m_2",
  scope: "you",
  author: "helper",
  agent: "explorer",
  state: "stale",
  title: "The retry policy is set in app/client.py",
  text: "The retry policy is set in app/client.py (RETRY), overridden in jobs/sync.py.",
  sources: [
    { path: "app/client.py", sha256: "a", size: 1, mtime_ns: 1, checked_at: "x" },
    { path: "jobs/sync.py", sha256: "b", size: 1, mtime_ns: 1, checked_at: "x" },
  ],
  uses: 3,
};
const proposal: MemoryItem = { ...base, id: "m_3", scope: "you", author: "lead", state: "proposed", title: "Tests use vitest", text: "Tests use vitest", kept_by: null };
const localOnly: MemoryItem = { ...base, id: "m_4", scope: "you", author: "you", state: "kept", kept_by: "you", title: "My salary", text: "My salary", privacy: "local", usable: false };

const counts = { you: 4, project: 14, history: 31 };
const settings = { you: "chat", projects: "chat", history: "chat" } as const;

function listOf(items: MemoryItem[], total = items.length): MemoryList {
  return { items, total, counts, settings, error: null };
}

const list = listOf([pnpm, retry, proposal, localOnly]);

function press(state: MemoryManagerState, key: MemoryManagerKey, l: MemoryList = list) {
  return pressMemoryManager(state, l, key);
}

function key(input: string, name: Press["name"] = null, extra: Partial<Press> = {}): Press {
  return { name, input, ctrl: false, meta: false, ...extra };
}

const open = openMemoryManager();

test("keys map to names, and letters are text while the search line is open", () => {
  assert.equal(memoryManagerKeyOf(key("/")), "search");
  assert.equal(memoryManagerKeyOf(key("e")), "edit");
  assert.equal(memoryManagerKeyOf(key("d")), "delete");
  assert.equal(memoryManagerKeyOf(key("p")), "pin");
  assert.equal(memoryManagerKeyOf(key("x")), "export");
  assert.equal(memoryManagerKeyOf(key("y")), "yes");
  assert.equal(memoryManagerKeyOf(key("", "tab")), "right");
  assert.equal(memoryManagerKeyOf(key("", "tab", { shift: true })), "left");
  assert.equal(memoryManagerKeyOf(key("", "escape")), "back");
  assert.equal(memoryManagerKeyOf(key("", "return")), "enter");
  assert.deepEqual(memoryManagerKeyOf(key("e"), true), { text: "e" });
  assert.deepEqual(memoryManagerKeyOf(key("/"), true), { text: "/" });
  assert.equal(memoryManagerKeyOf(key("", "backspace"), true), "erase");
  assert.equal(memoryManagerKeyOf(key("", "ctrl-u"), true), "clear");
  assert.equal(memoryManagerKeyOf(key("z")), null);
});

test("up and down move the cursor and stop at the ends", () => {
  assert.equal(press(open, "up").state.selected, 0);
  const down = press(open, "down").state;
  assert.equal(down.selected, 1);
  assert.equal(press({ ...open, selected: 3 }, "down").state.selected, 3);
  assert.equal(press(down, "up").state.selected, 0);
});

test("down past the last row of a page asks for the next page after the last id", () => {
  const paged = listOf([pnpm, retry], 5);
  const pressed = press({ ...open, selected: 1 }, "down", paged);
  assert.deepEqual(pressed.action, { kind: "more", after: "m_2" });
});

test("left and right change the tab, wrap, and read the list again", () => {
  const right = press(open, "right");
  assert.equal(right.state.tab, "project");
  assert.deepEqual(right.action, { kind: "reload" });
  assert.equal(press(right.state, "right").state.tab, "history");
  assert.equal(press({ ...open, tab: "history" }, "right").state.tab, "you");
  assert.equal(press(open, "left").state.tab, "history");
  assert.equal(press({ ...open, selected: 2 }, "right").state.selected, 0);
});

test("/ opens the search, letters build the query, Enter reads the list, Esc clears it", () => {
  let state = press(open, "search").state;
  assert.equal(state.typing, true);
  state = press(state, { text: "pn" }).state;
  state = press(state, { text: "pm" }).state;
  assert.equal(state.query, "pnpm");
  state = press(state, "erase").state;
  assert.equal(state.query, "pnp");
  const entered = press(state, "enter");
  assert.equal(entered.state.typing, false);
  assert.equal(entered.state.query, "pnp");
  assert.deepEqual(entered.action, { kind: "reload" });
  const cleared = press(entered.state, "back");
  assert.equal(cleared.state.open, true);
  assert.equal(cleared.state.query, "");
  assert.deepEqual(cleared.action, { kind: "reload" });
  assert.equal(press({ ...open, typing: true, query: "ab" }, "clear").state.query, "");
  const escaped = press({ ...open, typing: true }, "back");
  assert.deepEqual(escaped.action, { kind: "none" });
  assert.equal(escaped.state.typing, false);
});

test("letters typed in the search are not shortcuts", () => {
  const typing = { ...open, typing: true };
  const pressed = press(typing, { text: "d" });
  assert.deepEqual(pressed.action, { kind: "none" });
  assert.equal(pressed.state.confirm, null);
  assert.equal(pressed.state.query, "d");
});

test("e edits the selected memory's text", () => {
  assert.deepEqual(press({ ...open, selected: 1 }, "edit").action, { kind: "edit", id: "m_2", text: retry.text });
});

test("d asks first, y deletes, any other key keeps it", () => {
  const asked = press({ ...open, selected: 1 }, "delete");
  assert.equal(asked.state.confirm, "m_2");
  assert.deepEqual(asked.action, { kind: "none" });
  assert.deepEqual(press(asked.state, "yes").action, { kind: "delete", id: "m_2" });
  assert.equal(press(asked.state, "yes").state.confirm, null);
  const no = press(asked.state, "down");
  assert.equal(no.state.confirm, null);
  assert.equal(no.state.selected, 1);
  assert.deepEqual(no.action, { kind: "none" });
  assert.equal(press(asked.state, "back").state.open, true);
});

test("a proposal can be deleted too", () => {
  assert.equal(press({ ...open, selected: 2 }, "delete").state.confirm, "m_3");
});

test("p puts a memory in every chat, and takes it out again", () => {
  assert.deepEqual(press({ ...open, selected: 1 }, "pin").action, { kind: "pin", id: "m_2", always: true });
  assert.deepEqual(press(open, "pin").action, { kind: "pin", id: "m_1", always: false });
});

test("x exports the tab to golem-memory-<scope>.md", () => {
  assert.deepEqual(press(open, "export").action, { kind: "export", scope: "you", file: "golem-memory-you.md" });
  assert.deepEqual(press({ ...open, tab: "project" }, "export").action, {
    kind: "export",
    scope: "project",
    file: "golem-memory-project.md",
  });
  assert.equal(memoryExportFile("history"), "golem-memory-history.md");
});

test("k on a proposal says keeping is not built, and does nothing else", () => {
  const pressed = press({ ...open, selected: 2 }, "keep");
  assert.deepEqual(pressed.action, { kind: "none" });
  assert.equal(pressed.state.message, "keeping a proposal is not built yet");
  assert.equal(press(open, "keep").state.message, null);
});

test("Esc closes, and the keys do nothing on an empty list", () => {
  assert.deepEqual(press(open, "back").action, { kind: "close" });
  assert.equal(press(open, "back").state.open, false);
  for (const k of ["edit", "delete", "pin", "export"] as const) {
    assert.deepEqual(pressMemoryManager(open, listOf([]), k).action, { kind: "none" });
  }
});

test("the list call carries the tab, the search, the folder for a project and the cursor", () => {
  assert.deepEqual(memoryListParams(open, "/r/app"), { scope: "you", limit: 50 });
  assert.deepEqual(memoryListParams({ ...open, tab: "project", query: " pnpm " }, "/r/app", "m_9"), {
    scope: "project",
    limit: 50,
    folder: "/r/app",
    query: "pnpm",
    after: "m_9",
  });
});

test("the project folder is the nearest one with .git or .golem, else the folder itself", () => {
  const has = (...paths: string[]) => (path: string) => paths.includes(path);
  assert.equal(projectFolderOf("/r/app/src/deep", has("/r/app/.git")), "/r/app");
  assert.equal(projectFolderOf("/r/app/src", has("/r/app/.golem")), "/r/app");
  assert.equal(projectFolderOf("/r/app/src", has()), "/r/app/src");
  assert.equal(projectFolderOf("/link", has("/real/.git"), () => "/real/sub"), "/real");
  assert.equal(projectFolderOf("/", has()), "/");
});

test("an edited text is the same, empty, or new without trailing blank lines", () => {
  assert.deepEqual(memoryEdited("a b", "a b\n"), { kind: "same" });
  assert.deepEqual(memoryEdited("a b", " \n"), { kind: "empty" });
  assert.deepEqual(memoryEdited("a b", "a c\n\n"), { kind: "changed", text: "a c" });
});

test("memory off is told from the daemon's answer", () => {
  assert.equal(memoryIsOff("memory is off: [memory] enabled = false"), true);
  assert.equal(memoryIsOff("request failed"), false);
  assert.equal(memoryIsOff(null), false);
});

test("the row to delete is found by id", () => {
  assert.equal(memoryToDelete({ ...open, confirm: "m_2" }, list), retry);
  assert.equal(memoryToDelete({ ...open, confirm: "gone" }, list), null);
  assert.equal(memoryToDelete(open, list), null);
});

test("marks and the use line say what a row is", () => {
  assert.deepEqual(memoryMark(pnpm), { text: "●", tone: "ok" });
  assert.deepEqual(memoryMark(retry), { text: "◐", tone: "wait" });
  assert.deepEqual(memoryMark(proposal), { text: "?", tone: "wait" });
  assert.deepEqual(memoryMark(localOnly), { text: "○", tone: "off" });
  assert.equal(memoryUseLine(retry, settings), "used 3 times · may be sent to a paid model: yes, in a chat that is not private");
  assert.equal(memoryUseLine(pnpm, settings).startsWith("not used yet"), true);
  assert.match(memoryUseLine(localOnly, settings), /no \(this memory is set to local\)/);
  assert.match(memoryUseLine(pnpm, { ...settings, you: "local" }), /no \(You is set to local\)/);
});

function texts(lines: ReturnType<typeof layoutMemoryManager>): string[] {
  return lines.map((line) => `${line.prefix ?? ""}${line.mark ? `${line.mark.text} ` : ""}${line.text}`);
}

function layout(state: MemoryManagerState, l: MemoryList, columns = 100, rows = 24) {
  return texts(layoutMemoryManager({ state, list: l, folder: "/Users/me/app", home: "/Users/me", columns, rows }));
}

test("the wide screen has tabs with counts, rows with who and state, and a detail with sources, uses and paid", () => {
  const lines = layout({ ...open, selected: 1 }, list);
  assert.equal(lines[0], "Memory");
  assert.equal(lines[1], "[You 4]  This project 14   History 31 ");
  assert.ok(lines.some((line) => line.startsWith("  ● I prefer pnpm") && line.includes("you said · in every chat")));
  assert.ok(lines.some((line) => line.startsWith("❯ ◐ The retry policy") && line.includes("an explorer · 2 files · may be out of date")));
  assert.ok(lines.some((line) => line.startsWith("  ? Tests use vitest") && line.includes("waiting for you")));
  assert.ok(lines.includes("  from app/client.py, jobs/sync.py"));
  assert.ok(lines.includes("  used 3 times · may be sent to a paid model: yes, in a chat that is not private"));
  assert.ok(lines.at(-1)?.includes("e edit · d delete · x export · esc close"));
  assert.ok(!lines.some((line) => line.includes("k keep")));
});

test("a proposal shows waiting for you and the keys that work on it", () => {
  const lines = layout({ ...open, selected: 2 }, list);
  assert.ok(lines.at(-1)?.includes("e edit · d delete · esc close"));
  assert.ok(!lines.at(-1)?.includes("export"));
});

test("a local memory with no local model says it is not used", () => {
  const lines = layout({ ...open, selected: 3 }, list);
  assert.ok(lines.includes("  not used: no local model is set up"));
  assert.ok(lines.some((line) => line.startsWith("❯ ○ My salary") && line.includes("local models only")));
});

test("a local memory with a local model has no unused note", () => {
  const usable = listOf([{ ...localOnly, usable: true }]);
  const lines = layout(open, usable);
  assert.ok(!lines.some((line) => line.includes("not used: no local model")));
  assert.ok(lines.some((line) => line.startsWith("❯ ● My salary")));
  assert.ok(lines.includes("  used 0 times".replace("used 0 times", "not used yet") + " · may be sent to a paid model: no (this memory is set to local)"));
});

test("a cloud-only setup lists the same rows and no local note for a chat memory", () => {
  const lines = layout(open, listOf([pnpm]));
  assert.ok(!lines.some((line) => line.includes("not used")  && line.includes("no local model")));
});

test("the project tab names the folder, and a search shows its text and how many it found", () => {
  const project = layout({ ...open, tab: "project" }, listOf([]));
  assert.ok(project.includes("Notes about ~/app"));
  const searching = layout({ ...open, typing: true, query: "pn" }, list);
  assert.ok(searching.includes("/ pn▏"));
  const found = layout({ ...open, query: "pn" }, listOf([pnpm]));
  assert.ok(found.includes("/ pn  1 found"));
});

test("empty: says what to do, and for a search what did not match", () => {
  const empty = layout(open, listOf([]));
  assert.ok(empty.includes("Nothing in You yet."));
  assert.ok(empty.includes('Say "remember that I prefer pnpm" in a chat.'));
  assert.ok(empty.at(-1)?.includes("esc close"));
  assert.ok(layout({ ...open, query: "zzz" }, listOf([])).includes('No memory in You matches "zzz".'));
});

test("memory off shows the daemon's words and how to leave", () => {
  const lines = layout(open, { ...emptyMemoryList, error: "memory is off: [memory] enabled = false" });
  assert.deepEqual(lines, ["Memory", "", "memory is off: [memory] enabled = false", "", "esc close"]);
});

test("before the answer it says it is asking", () => {
  assert.ok(layout(open, emptyMemoryList).includes("asking the daemon…"));
});

test("delete asks by the memory's title", () => {
  const lines = layout({ ...open, confirm: "m_1" }, list);
  assert.ok(lines.includes('delete "I prefer pnpm"?'));
  assert.ok(lines.at(-1)?.startsWith("delete? y yes"));
});

test("more rows than the page say so", () => {
  const lines = layout(open, listOf([pnpm, retry], 7));
  assert.ok(lines.some((line) => line.includes("5 more")));
});

test("the narrow screen fits every line, drops the right column and keeps who and state in the detail", () => {
  for (const columns of [24, 40, 60]) {
    const lines = layoutMemoryManager({ state: { ...open, selected: 1 }, list, folder: "/Users/me/app", home: "/Users/me", columns, rows: 24 });
    for (const line of lines) {
      const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0) + line.text.length;
      assert.ok(used <= columns, `${columns}: "${line.text}" is ${used} wide`);
    }
  }
  const lines = layout({ ...open, selected: 1 }, list, 50);
  assert.ok(lines.includes("  an explorer · 2 files · may be out of date"));
  assert.ok(lines.some((line) => line.startsWith("❯ ◐ The retry policy")));
  assert.ok(!lines.some((line) => line.startsWith("❯ ◐") && line.includes("explorer")));
  assert.ok(lines.join(" ").replace(/\s+/g, " ").includes("used 3 times · may be sent to a paid model: yes, in a chat that is not private"));
  assert.equal(lines.at(-1), "e edit · d delete · x export · esc close");
});

test("a short screen keeps the selected row and the hint on screen", () => {
  const many = listOf(Array.from({ length: 20 }, (_, i) => ({ ...pnpm, id: `m_${i}`, title: `note ${i}`, text: `note ${i}` })));
  const lines = layout({ ...open, selected: 15 }, many, 80, 12);
  assert.equal(lines.length <= 12, true);
  assert.ok(lines.some((line) => line.startsWith("❯ ● note 15")));
  assert.ok(lines.at(-1)?.includes("esc close"));
});

test("closed state is closed and starts on You", () => {
  assert.equal(closedMemoryManager.open, false);
  assert.equal(open.tab, "you");
});
