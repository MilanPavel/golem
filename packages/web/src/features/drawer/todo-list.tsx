import type { TodoItem, TodoStatus } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import "./drawer.css";

const WORD: Record<TodoStatus, string> = { done: "Done:", in_progress: "In progress:", pending: "To do:" };

const SEGMENT: Record<TodoStatus, string> = {
  done: "bg-allow",
  in_progress: "bg-clay",
  pending: "bg-line-strong",
};

function Tick() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-full text-surface">
      <path d="M2 5.2l2 2L8 3" />
    </svg>
  );
}

function Item({ todo }: { todo: TodoItem }) {
  const { status } = todo;
  return (
    <li
      data-status={status}
      aria-current={status === "in_progress" ? "step" : undefined}
      className={cn("flex items-start gap-2.5 rounded-sm px-2 py-1.5 text-sm", status === "in_progress" && "bg-clay-soft")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-3.5 flex-none rounded-xs border-2",
          status === "done" && "border-allow bg-allow",
          status === "in_progress" && "todo-hatch border-clay",
          status === "pending" && "border-line-strong",
        )}
      >
        {status === "done" ? <Tick /> : null}
      </span>
      <span
        className={cn(
          "min-w-0 wrap-anywhere",
          status === "done" && "text-faint line-through decoration-line-strong",
          status === "in_progress" && "font-medium",
        )}
      >
        <span className="sr-only">{WORD[status]} </span>
        {todo.text}
      </span>
    </li>
  );
}

/** The agent's plan: how far it is, then every step with its state. */
export function TodoList({ todos }: { todos: readonly TodoItem[] }) {
  if (todos.length === 0) {
    return <p className="text-sm text-muted">No todos yet. golem makes a list when a task has several steps.</p>;
  }
  const done = todos.filter((todo) => todo.status === "done").length;
  return (
    <>
      <div className="flex items-center gap-2.5 font-mono text-xs text-muted">
        <p>
          {done} of {todos.length}
        </p>
        <div aria-hidden="true" className="flex h-1 flex-1 gap-0.5 overflow-hidden rounded-xs bg-sunken">
          {todos.map((todo) => (
            <span key={todo.id} className={cn("flex-1", SEGMENT[todo.status])} />
          ))}
        </div>
      </div>
      <ul aria-label="Todos" className="flex list-none flex-col gap-0.5 p-0">
        {todos.map((todo) => (
          <Item key={todo.id} todo={todo} />
        ))}
      </ul>
    </>
  );
}
