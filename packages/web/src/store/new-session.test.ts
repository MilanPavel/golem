import { expect, test } from "vitest";
import { createNewSessionFolder, distinctFolders, resolveFolder } from "./new-session.ts";
import { summary } from "./test-support.ts";

const list = [
  summary("a", "2026-11-01T12:00:00Z", "/x/golem"),
  { ...summary("b", "2026-11-01T11:00:00Z", "/x/notes"), status: "closed" as const },
  summary("c", "2026-11-01T10:00:00Z", "/x/golem"),
  summary("d", "2026-11-01T09:00:00Z", "/x/other"),
  summary("e", "2026-11-01T08:00:00Z", null),
];

test("with nothing chosen or opened, the newest session's folder", () => {
  const store = createNewSessionFolder();
  expect(resolveFolder(store.getSnapshot(), list)).toBe("/x/golem");
  expect(resolveFolder(store.getSnapshot(), [])).toBeNull();
  expect(resolveFolder(store.getSnapshot(), [list[4]!])).toBeNull();
});

test("the last opened session's folder beats the newest, including no folder", () => {
  const store = createNewSessionFolder();
  store.opened("/x/other");
  expect(resolveFolder(store.getSnapshot(), list)).toBe("/x/other");
  store.opened(null);
  expect(resolveFolder(store.getSnapshot(), list)).toBeNull();
});

test("a pick beats both, and opening a session drops it", () => {
  const store = createNewSessionFolder();
  store.opened("/x/other");
  store.choose("/typed");
  expect(resolveFolder(store.getSnapshot(), list)).toBe("/typed");
  store.choose(null);
  expect(resolveFolder(store.getSnapshot(), list)).toBeNull();
  store.opened("/x/golem");
  expect(resolveFolder(store.getSnapshot(), list)).toBe("/x/golem");
});

test("the snapshot is stable when nothing changes", () => {
  const store = createNewSessionFolder();
  store.opened("/a");
  const before = store.getSnapshot();
  store.opened("/a");
  expect(store.getSnapshot()).toBe(before);
});

test("distinct folders skip closed sessions and no folder, newest first", () => {
  expect(distinctFolders(list)).toEqual(["/x/golem", "/x/other"]);
});
