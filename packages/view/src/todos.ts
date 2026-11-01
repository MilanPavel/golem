/** The agent's todo list above the composer: one row per item, or one summary row. */

export type TodoStatus = "pending" | "in_progress" | "done";

export type TodoItem = {
  id: string;
  text: string;
  status: TodoStatus;
};

export type TodoLine = {
  text: string;
  status: TodoStatus | "summary";
};

/** At most this many rows for the list. More items than that collapse to one row. */
export const TODO_ROWS = 6;

const MARKS: Record<TodoStatus, string> = { pending: "[ ]", in_progress: "[~]", done: "[x]" };

/** Rows the band wants: none for an empty list, one when it is finished or too long, else one per item. */
export function todoRows(todos: readonly TodoItem[]): number {
  if (todos.length === 0) {
    return 0;
  }
  if (todos.every((todo) => todo.status === "done") || todos.length > TODO_ROWS) {
    return 1;
  }
  return todos.length;
}

/** The band in `rows` rows. Fewer rows than items gives `todos 2/5 · <the current step>`. */
export function todoLines(todos: readonly TodoItem[], columns: number, rows: number): TodoLine[] {
  if (todos.length === 0 || rows <= 0) {
    return [];
  }
  const width = Math.max(1, columns);
  if (rows < todos.length || todos.every((todo) => todo.status === "done")) {
    return [{ text: fit(summary(todos), width), status: "summary" }];
  }
  return todos.map((todo) => ({ text: fit(`${MARKS[todo.status]} ${todo.text}`, width), status: todo.status }));
}

function summary(todos: readonly TodoItem[]): string {
  const done = todos.filter((todo) => todo.status === "done").length;
  const current = todos.find((todo) => todo.status === "in_progress") ?? todos.find((todo) => todo.status !== "done");
  return current === undefined ? `todos ${done}/${todos.length} done` : `todos ${done}/${todos.length} · ${current.text}`;
}

function fit(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ");
  return flat.length <= width ? flat : `${flat.slice(0, Math.max(0, width - 1))}…`;
}
