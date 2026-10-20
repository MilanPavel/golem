"""``todo_write``: the agent's plan for a multi-step task, which you see as a checklist.

Each call replaces the whole list. The list is graph state, so it is in the
checkpoint and survives a restart, and each change is a ``todos.updated``
event. It changes nothing outside golem, so it needs no approval.
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from golem.tools.registry import Tool, ToolContext, ToolResult

MAX_TODOS = 30
MARKS = {"pending": "[ ]", "in_progress": "[~]", "done": "[x]"}


class TodoItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=40, description="A short stable id, such as 1.")
    text: str = Field(min_length=1, max_length=300, description="The step, in a few words.")
    status: Literal["pending", "in_progress", "done"]


class TodoWriteArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    todos: list[TodoItem] = Field(
        max_length=MAX_TODOS, description="The whole list, in order. An empty list clears it."
    )

    @model_validator(mode="after")
    def _one_at_a_time(self) -> Self:
        ids = [item.id for item in self.todos]
        if len(set(ids)) != len(ids):
            raise ValueError("each todo needs its own id")
        if sum(item.status == "in_progress" for item in self.todos) > 1:
            raise ValueError("at most one todo is in_progress at a time")
        return self


async def _todo_write(args: TodoWriteArgs, ctx: ToolContext) -> ToolResult:
    del ctx
    todos = [item.model_dump() for item in args.todos]
    done = sum(item.status == "done" for item in args.todos)
    lines = [f"{MARKS[item.status]} {item.id}. {item.text}" for item in args.todos]
    output = "\n".join(lines) if lines else "(the todo list is empty)"
    summary = f"{done}/{len(todos)} done" if todos else "cleared"
    return ToolResult(output=output, summary=summary, update={"todos": todos})


TODO_WRITE = Tool(
    name="todo_write",
    description=(
        "Keep a todo list for a task with three or more steps, so the user sees the plan. "
        "Send the whole list each time: mark a step in_progress when you start it and done "
        "when it is finished, one in_progress at a time."
    ),
    args=TodoWriteArgs,
    run=_todo_write,
    internal=True,
)

__all__ = ["MAX_TODOS", "TODO_WRITE", "TodoItem", "TodoWriteArgs"]
