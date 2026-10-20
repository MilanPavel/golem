import assert from "node:assert/strict";
import { test } from "node:test";

import { type TodoItem, todoLines, todoRows, TODO_ROWS } from "./todos.ts";

const plan: TodoItem[] = [
  { id: "1", text: "add a flag", status: "done" },
  { id: "2", text: "wire it up", status: "in_progress" },
  { id: "3", text: "write a test", status: "pending" },
];

test("one row per item with its mark, while there is room", () => {
  assert.equal(todoRows(plan), 3);
  assert.deepEqual(
    todoLines(plan, 80, 3).map((line) => line.text),
    ["[x] add a flag", "[~] wire it up", "[ ] write a test"],
  );
});

test("short rows, a long list, or a finished one collapse to a summary", () => {
  assert.deepEqual(todoLines(plan, 80, 1), [{ text: "todos 1/3 · wire it up", status: "summary" }]);
  const long = Array.from({ length: TODO_ROWS + 1 }, (_, index): TodoItem => ({
    id: String(index),
    text: `step ${index}`,
    status: "pending",
  }));
  assert.equal(todoRows(long), 1);
  const finished = plan.map((todo) => ({ ...todo, status: "done" as const }));
  assert.equal(todoRows(finished), 1);
  assert.deepEqual(todoLines(finished, 80, 3), [{ text: "todos 3/3 done", status: "summary" }]);
});

test("an empty list takes no rows", () => {
  assert.equal(todoRows([]), 0);
  assert.deepEqual(todoLines([], 80, 3), []);
});
