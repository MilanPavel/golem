import { expect, test } from "vitest";
import { summary } from "../../store/test-support.ts";
import { forkRows } from "./fork-tree.ts";

const make = (id: string, forkedFrom?: string, title: string | null = null) => ({
  ...summary(id, "2026-11-01T10:00:00Z"),
  title,
  ...(forkedFrom === undefined ? {} : { forked_from: forkedFrom }),
});

const shape = (rows: ReturnType<typeof forkRows>) => rows.map((row) => `${row.session.session_id}:${row.depth}`);

test("a list without forks keeps its order and depth 0", () => {
  const rows = forkRows([make("a"), make("b"), make("c")]);
  expect(shape(rows)).toEqual(["a:0", "b:0", "c:0"]);
  expect(rows.some((row) => row.forked)).toBe(false);
});

test("a fork sits right under its parent, even when it is newer than other sessions", () => {
  // Newest first: the fork f is newest, then x, then its parent p.
  const rows = forkRows([make("f", "p"), make("x"), make("p")]);
  expect(shape(rows)).toEqual(["x:0", "p:0", "f:1"]);
});

test("parents keep their order and siblings stay newest first", () => {
  const rows = forkRows([make("p2"), make("c2b", "p2"), make("p1"), make("c1b", "p1"), make("c2a", "p2"), make("c1a", "p1")]);
  expect(shape(rows)).toEqual(["p2:0", "c2b:1", "c2a:1", "p1:0", "c1b:1", "c1a:1"]);
});

test("forks of forks go one level deeper each time", () => {
  const rows = forkRows([make("c", "b"), make("b", "a"), make("a")]);
  expect(shape(rows)).toEqual(["a:0", "b:1", "c:2"]);
  expect(rows.map((row) => row.indent)).toEqual([0, 1, 2]);
});

test("the indent stops at three levels, the depth does not", () => {
  const rows = forkRows([make("e", "d"), make("d", "c"), make("c", "b"), make("b", "a"), make("a")]);
  expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3, 4]);
  expect(rows.map((row) => row.indent)).toEqual([0, 1, 2, 3, 3]);
});

test("a fork whose parent is not shown is a top-level row that is still marked", () => {
  const rows = forkRows([make("o", "gone"), make("a")]);
  expect(shape(rows)).toEqual(["o:0", "a:0"]);
  expect(rows[0]).toMatchObject({ forked: true, parentShown: false, parentTitle: null });
  expect(rows[1]).toMatchObject({ forked: false });
});

test("a fork row names its parent's title", () => {
  const rows = forkRows([make("p", undefined, "Parent"), make("f", "p")]);
  expect(rows[1]).toMatchObject({ forked: true, parentShown: true, parentTitle: "Parent" });
});

test("a loop of forks and a session that names itself still show every session once", () => {
  const rows = forkRows([make("a", "b"), make("b", "a"), make("s", "s")]);
  expect(rows.map((row) => row.session.session_id).sort()).toEqual(["a", "b", "s"]);
});
