import type { TodoItem } from "@golem/view";
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { TodoList } from "./todo-list.tsx";

const todos: TodoItem[] = [
  { id: "1", text: "Find the decoder", status: "done" },
  { id: "2", text: "Write a test", status: "done" },
  { id: "3", text: "Decode with a streaming TextDecoder", status: "in_progress" },
  { id: "4", text: "Run the client tests", status: "pending" },
];

test("it counts the done items and draws one segment per item", () => {
  const { container } = render(<TodoList todos={todos} />);
  expect(screen.getByText("2 of 4")).toBeTruthy();
  const bar = container.querySelector("[aria-hidden='true'].flex-1") as HTMLElement;
  expect([...bar.children].map((c) => c.className)).toEqual([
    "flex-1 bg-allow",
    "flex-1 bg-allow",
    "flex-1 bg-clay",
    "flex-1 bg-line-strong",
  ]);
});

test("each item has a status word before its text", () => {
  render(<TodoList todos={todos} />);
  const items = within(screen.getByRole("list", { name: "Todos" })).getAllByRole("listitem");
  expect(items.map((li) => li.textContent)).toEqual([
    "Done: Find the decoder",
    "Done: Write a test",
    "In progress: Decode with a streaming TextDecoder",
    "To do: Run the client tests",
  ]);
});

test("only the item in progress is the current step", () => {
  render(<TodoList todos={todos} />);
  const items = screen.getAllByRole("listitem");
  expect(items.map((li) => li.getAttribute("aria-current"))).toEqual([null, null, "step", null]);
});

test("an empty list says how it comes about", () => {
  render(<TodoList todos={[]} />);
  expect(screen.getByText("No todos yet. golem makes a list when a task has several steps.")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
});

test("a long item wraps and its text stays text", () => {
  const text = `${"very-long-unbroken-".repeat(20)} <b>not bold</b>`;
  const { container } = render(<TodoList todos={[{ id: "1", text, status: "pending" }]} />);
  expect(screen.getByRole("listitem").textContent).toBe(`To do: ${text}`);
  expect(container.querySelector("b")).toBeNull();
  expect(container.querySelector(".wrap-anywhere.min-w-0")).toBeTruthy();
});
