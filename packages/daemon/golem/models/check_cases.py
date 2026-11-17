"""The cases of ``golem models check``: small tasks that need a tool, or none.

A case is a prompt, the tools offered (golem's real schemas, by name), and a checker of the
model's replies. The checker says why a reply is wrong, or returns None. Arguments are
validated with the registry's own validation, so "valid" means what golem means. A case says
nothing about any one project: its files and words are made up.

The eval harness can reuse :data:`CASES`: nothing here runs a tool or calls a model.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import cast

from langchain_core.messages import AIMessage, BaseMessage, ToolCall, ToolMessage

from golem.sessions.ids import new_id
from golem.tools.registry import ToolError, ToolRegistry

SYSTEM = (
    "You are an assistant with tools for working in a folder. Call a tool when you need one. "
    "When you can answer without a tool, answer in plain text."
)

SMALL_PREDICT = 96
"""The reply limit of the case that cuts a long call short."""

MAX_ROUNDS = 3


@dataclass(frozen=True, slots=True)
class Reply:
    """One reply of the model: its text, the calls golem would run, and how it got them.

    ``recovered`` is true when the model wrote its calls as text and golem read them.
    """

    text: str
    calls: tuple[ToolCall, ...] = ()
    recovered: bool = False


Check = Callable[[Sequence[Reply], ToolRegistry], str | None]
Follow = Callable[[Reply], list[ToolMessage] | None]


@dataclass(frozen=True, slots=True)
class CheckCase:
    """``tools`` are the names offered, or None for every built-in tool.

    ``before`` are messages after the prompt, a fake earlier turn. ``follow`` gives canned
    tool results for a reply that called tools, to ask again, or None to stop. ``check``
    reads every reply of the case.
    """

    id: str
    title: str
    prompt: str
    check: Check
    tools: tuple[str, ...] | None = ("read_file", "list_dir", "glob", "grep")
    before: tuple[BaseMessage, ...] = ()
    follow: Follow | None = None
    num_predict: int | None = None


def invalid(tools: ToolRegistry, call: ToolCall) -> str | None:
    """Why ``call`` is not a valid call of an offered tool, or None when it is."""
    try:
        tools.validate(call["name"], call["args"])
    except ToolError as exc:
        return str(exc)
    return None


def _only_call(replies: Sequence[Reply], tools: ToolRegistry, name: str) -> ToolCall | str:
    """The one valid call of ``name`` in the first reply, or the reason it is not."""
    reply = replies[0]
    if not reply.calls:
        return "no tool call" + (f"; it wrote: {_short(reply.text)}" if reply.text.strip() else "")
    call = reply.calls[0]
    if call["name"] != name:
        return f"called {call['name']}, not {name}"
    problem = invalid(tools, call)
    return call if problem is None else problem


def _short(text: str, limit: int = 60) -> str:
    one = " ".join(text.split())
    return one if len(one) <= limit else one[: limit - 1] + "…"


def _path_of(call: ToolCall) -> str:
    value = call["args"].get("path")
    text = value if isinstance(value, str) else ""
    return text.strip().removeprefix("./").rstrip("/")


def _check_read(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    found = _only_call(replies, tools, "read_file")
    if isinstance(found, str):
        return found
    return None if _path_of(found).endswith("notes/todo.txt") else f"read {_path_of(found)}"


def _check_search(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    found = _only_call(replies, tools, "grep")
    if isinstance(found, str):
        return found
    pattern = str(found["args"].get("pattern", ""))
    return None if "invoice" in pattern.lower() else f"searched for {_short(pattern)}"


def _check_list(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    found = _only_call(replies, tools, "list_dir")
    if isinstance(found, str):
        return found
    return None if _path_of(found) == "reports" else f"listed {_path_of(found) or '.'}"


def _check_no_tool(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    del tools
    reply = replies[0]
    if reply.calls:
        return f"called {reply.calls[0]['name']} for a question that needs no tool"
    return None if reply.text.strip() else "no answer"


def _follow_one(reply: Reply) -> list[ToolMessage] | None:
    """Canned file contents for the case that reads two files, only after a single call."""
    if len(reply.calls) != 1:
        return None
    call = reply.calls[0]
    content = f"(contents of {_path_of(call)}: three short lines)"
    return [ToolMessage(content=content, tool_call_id=call["id"] or new_id("c"))]


def _check_two_files(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    paths: list[str] = []
    for reply in replies:
        for call in reply.calls:
            if call["name"] != "read_file":
                return f"called {call['name']}, not read_file"
            problem = invalid(tools, call)
            if problem is not None:
                return problem
            paths.append(_path_of(call))
    if not paths:
        return "no tool call"
    missing = {"a.txt", "b.txt"} - {path.rpartition("/")[2] for path in paths}
    if missing:
        return f"never read {', '.join(sorted(missing))}"
    return None


def _check_nested(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    found = _only_call(replies, tools, "todo_write")
    if isinstance(found, str):
        return found
    todos = found["args"].get("todos")
    count = len(cast(list[object], todos)) if isinstance(todos, list) else 0
    return None if count >= 3 else f"{count} todos, three asked"


def _check_missing(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    reply = replies[0]
    for call in reply.calls:
        problem = invalid(tools, call)
        if problem is not None:
            return problem
    if reply.calls or reply.text.strip():
        return None
    return "no answer"


SETTINGS_CALL = ToolCall(name="read_file", args={"path": "settings.txt"}, id="call_seed")


def _check_follow_up(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    reply = replies[0]
    for call in reply.calls:
        if call["name"] == SETTINGS_CALL["name"] and call["args"] == SETTINGS_CALL["args"]:
            return "called read_file again with the same arguments"
        problem = invalid(tools, call)
        if problem is not None:
            return problem
    if reply.calls:
        return None
    if "8431" in reply.text:
        return None
    return f"the answer does not use the result: {_short(reply.text)}"


def _check_long_list(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    found = _only_call(replies, tools, "glob")
    if isinstance(found, str):
        return found
    pattern = str(found["args"].get("pattern", ""))
    return None if ".md" in pattern else f"matched {_short(pattern)}"


_CUT_MARKS = ("<tool_call", "<function=")


def looks_cut(text: str) -> bool:
    """Whether ``text`` is the start of a tool call that stops short."""
    one = text.strip()
    if any(mark in one for mark in _CUT_MARKS):
        return True
    return one.startswith(("{", "[{")) and ('"name"' in one or '"arguments"' in one)


def _check_short(replies: Sequence[Reply], tools: ToolRegistry) -> str | None:
    reply = replies[0]
    for call in reply.calls:
        problem = invalid(tools, call)
        if problem is not None:
            return problem
    if reply.calls:
        return None
    if looks_cut(reply.text):
        return "the reply stops in the middle of a call"
    return None if reply.text.strip() else "no reply"


CASES: tuple[CheckCase, ...] = (
    CheckCase(
        id="read_file",
        title="read a file",
        prompt="Read the file notes/todo.txt and show me what is in it.",
        check=_check_read,
    ),
    CheckCase(
        id="search",
        title="search",
        prompt="Search the folder docs for the word invoice.",
        check=_check_search,
    ),
    CheckCase(
        id="list_dir",
        title="list a folder",
        prompt="What files are in the folder reports?",
        check=_check_list,
    ),
    CheckCase(
        id="no_tool",
        title="no tool needed",
        prompt="What is the capital of France? Answer in one word.",
        check=_check_no_tool,
    ),
    CheckCase(
        id="two_files",
        title="two calls",
        prompt="Read both a.txt and b.txt, then tell me which one is longer.",
        check=_check_two_files,
        follow=_follow_one,
    ),
    CheckCase(
        id="nested",
        title="nested arguments",
        prompt=(
            "Make a todo list for cleaning a kitchen with three steps: wash the dishes, wipe the "
            "counters, sweep the floor. Mark the first one in progress and the others pending."
        ),
        tools=("todo_write", "read_file", "list_dir"),
        check=_check_nested,
    ),
    CheckCase(
        id="missing",
        title="missing argument",
        prompt="Read the file for me.",
        check=_check_missing,
    ),
    CheckCase(
        id="follow_up",
        title="use a tool result",
        prompt="Open the file settings.txt and tell me which port it names.",
        before=(
            AIMessage(content="", tool_calls=[SETTINGS_CALL]),
            ToolMessage(content="port = 8431\nmode = fast\n", tool_call_id="call_seed"),
        ),
        check=_check_follow_up,
    ),
    CheckCase(
        id="long_list",
        title="all the tools",
        prompt="Find every file whose name ends in .md under the folder docs.",
        tools=None,
        check=_check_long_list,
    ),
    CheckCase(
        id="short_reply",
        title="a short reply limit",
        prompt=(
            "Make a todo list for planning a trip with six steps: pick dates, book flights, "
            "book a hotel, plan meals, pack bags, arrange a ride to the airport. Mark them all "
            "pending."
        ),
        tools=("todo_write", "read_file", "list_dir"),
        check=_check_short,
        num_predict=SMALL_PREDICT,
    ),
)

__all__ = [
    "CASES",
    "MAX_ROUNDS",
    "SMALL_PREDICT",
    "SYSTEM",
    "Check",
    "CheckCase",
    "Reply",
    "invalid",
    "looks_cut",
]
