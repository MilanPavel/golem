"""File changes under approval: the diff the user sees is the change that is made."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import InvalidToolArgsError, SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem.tools.fs import READ_FILE
from golem.tools.paths import session_root
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem.tools.write import CHANGED_SINCE_APPROVAL, EDIT_FILE
from golem_protocol.events import (
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    ToolCompletedEvent,
    ToolFailedEvent,
)

Reply = str | list[tuple[str, dict[str, Any]]]


class _Chat:
    def __init__(
        self,
        database: Database,
        replies: list[Reply],
        home: Path,
        registry: ToolRegistry | None = None,
    ) -> None:
        self.model = ToolCallingChatModel(replies=replies)
        runtime = open_chat(
            ModelRouter(model=self.model),
            InMemorySaver(),
            registry or default_registry(),
            Policy(None, home=home),
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def settled(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            if run is None or run.status == "running":
                return False
            live = self.manager._runs.get(run_id)  # pyright: ignore[reportPrivateUsage]
            return live is None or live.task.done()

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _needed(events: list[ChatEvent]) -> list[ApprovalNeededEvent]:
    return [event for event in events if isinstance(event, ApprovalNeededEvent)]


def _project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "a.py").write_text("one\ntwo\nthree\n", encoding="utf-8")
    return project


def _edit(old: str, new: str) -> tuple[str, dict[str, Any]]:
    return ("edit_file", {"path": "a.py", "old_string": old, "new_string": new})


async def test_the_approval_carries_the_diff_and_allowing_applies_it(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[_edit("two", "TWO")], "done"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "shout two")

    asked = _needed(await chat.settled(run_id))[0].data
    assert asked.subject == "a.py"
    assert asked.diff is not None
    assert "-two\n+TWO\n" in asked.diff
    assert (project / "a.py").read_text(encoding="utf-8") == "one\ntwo\nthree\n"

    await chat.manager.respond(session_id, asked.call_id, "allow")
    events = await chat.settled(run_id)
    assert (project / "a.py").read_text(encoding="utf-8") == "one\nTWO\nthree\n"
    completed = [event for event in events if isinstance(event, ToolCompletedEvent)]
    assert completed[0].data.summary == "+1 -1 a.py"


async def test_a_file_changed_while_waiting_is_not_overwritten(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[("write_file", {"path": "a.py", "content": "new\n"})], "ok"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "replace it")
    asked = _needed(await chat.settled(run_id))[0].data

    (project / "a.py").write_text("someone else's edit\n", encoding="utf-8")
    await chat.manager.respond(session_id, asked.call_id, "allow")
    events = await chat.settled(run_id)

    assert (project / "a.py").read_text(encoding="utf-8") == "someone else's edit\n"
    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert failed[0].data.message == CHANGED_SINCE_APPROVAL.format(path="a.py")


async def test_two_edits_of_one_file_in_one_reply_build_on_each_other(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    replies: list[Reply] = [[_edit("one", "ONE"), _edit("ONE\ntwo", "ONE\nTWO")], "done"]
    chat = _Chat(database, replies, tmp_path)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "shout")

    first = _needed(await chat.settled(run_id))[0].data
    await chat.manager.respond(session_id, first.call_id, "allow")
    second = _needed(await chat.settled(run_id))[-1].data
    assert second.call_id != first.call_id
    assert second.diff is not None and "-two\n+TWO\n" in second.diff

    await chat.manager.respond(session_id, second.call_id, "allow")
    await chat.settled(run_id)
    assert (project / "a.py").read_text(encoding="utf-8") == "ONE\nTWO\nthree\n"


async def test_an_edit_that_cannot_apply_fails_without_asking(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[_edit("missing", "x")], "sorry"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "edit")

    events = await chat.settled(run_id)
    assert _needed(events) == []
    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert "old_string is not in a.py" in failed[0].data.message


async def test_edited_arguments_run_once_and_the_model_is_told(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[_edit("two", "2")], "done"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "fix two")
    asked = _needed(await chat.settled(run_id))[0].data

    edited: dict[str, object] = {"path": "a.py", "old_string": "two", "new_string": "TWO"}
    await chat.manager.respond(session_id, asked.call_id, "allow", edited)
    events = await chat.settled(run_id)

    assert (project / "a.py").read_text(encoding="utf-8") == "one\nTWO\nthree\n"
    resolved = [event for event in events if isinstance(event, ApprovalResolvedEvent)]
    assert resolved[0].data.args == edited
    result = chat.model.seen[1][-1]
    assert isinstance(result, ToolMessage)
    assert result.text.startswith("note: the user edited the arguments before it ran: ")
    assert '"new_string": "TWO"' in result.text


@pytest.mark.parametrize(
    ("decision", "args", "error"),
    [
        ("allow", {"path": "a.py"}, "invalid arguments for edit_file"),
        ("allow_session", {"path": "a.py", "old_string": "a", "new_string": "b"}, "run once"),
    ],
)
async def test_edited_arguments_the_tool_refuses_keep_the_run_waiting(
    database: Database, tmp_path: Path, decision: str, args: dict[str, Any], error: str
) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[_edit("two", "2")], "done"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "fix two")
    asked = _needed(await chat.settled(run_id))[0].data

    with pytest.raises(InvalidToolArgsError, match=error):
        await chat.manager.respond(session_id, asked.call_id, decision, args)  # type: ignore[arg-type]
    run = await chat.runs.get(run_id)
    assert run is not None and run.status == "waiting"


class _NoArgs(BaseModel):
    pass


async def _run_tests(args: _NoArgs, ctx: ToolContext) -> ToolResult:
    del args
    source = (session_root(ctx) / "calc.py").read_text(encoding="utf-8")
    passed = "return a + b" in source
    return ToolResult(output="1 passed" if passed else "1 failed: add(1, 2) == -1", summary="ran")


async def test_fixing_a_failing_test_runs_edits_and_runs_again(
    database: Database, tmp_path: Path
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "calc.py").write_text("def add(a, b):\n    return a - b\n", encoding="utf-8")
    tests = Tool(name="run_tests", description="", args=_NoArgs, run=_run_tests, read_only=True)
    registry = ToolRegistry([READ_FILE, EDIT_FILE, tests])
    fix = ("edit_file", {"path": "calc.py", "old_string": "a - b", "new_string": "a + b"})
    replies: list[Reply] = [[("run_tests", {})], [fix], [("run_tests", {})], "fixed"]
    chat = _Chat(database, replies, tmp_path, registry)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "fix the failing test")

    asked = _needed(await chat.settled(run_id))[0].data
    assert asked.name == "edit_file"
    await chat.manager.respond(session_id, asked.call_id, "allow")
    events = await chat.settled(run_id)

    outputs = [event.data.preview for event in events if isinstance(event, ToolCompletedEvent)]
    assert outputs[0].startswith("1 failed")
    assert outputs[-1] == "1 passed"
    assert events[-1].type == "run.completed"


async def test_a_deny_rule_written_while_waiting_wins_over_the_answer(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[_edit("two", "TWO")], "ok"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "shout two")
    asked = _needed(await chat.settled(run_id))[0].data

    rules = project / ".golem" / "policy.toml"
    rules.parent.mkdir()
    rules.write_text('[[rule]]\ntool = "edit_file"\naction = "deny"\n', encoding="utf-8")
    await chat.manager.respond(session_id, asked.call_id, "allow")
    events = await chat.settled(run_id)

    assert (project / "a.py").read_text(encoding="utf-8") == "one\ntwo\nthree\n"
    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert "denied by" in failed[0].data.message


async def test_arguments_sent_back_unchanged_are_not_an_edit(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[_edit("two", "TWO")], "ok"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "shout two")
    asked = _needed(await chat.settled(run_id))[0].data

    await chat.manager.respond(session_id, asked.call_id, "allow", dict(asked.args))
    events = await chat.settled(run_id)
    resolved = [event for event in events if isinstance(event, ApprovalResolvedEvent)]
    assert resolved[0].data.args is None
