"""A pinned skill that is edited, deleted, or broken on disk never breaks a session."""

from __future__ import annotations

import asyncio
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import BaseMessage, SystemMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import SkillSettings
from golem.graphs.chat import open_chat
from golem.graphs.prompt import SystemPrompt
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.skills.pinned import PinMemory, pinned_section
from golem.skills.registry import SkillRegistry
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    ChatEvent,
    MessageCompletedEvent,
    SkillActivatedEvent,
    SkillSkippedEvent,
)


def _write(folder: Path, body: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    text = f"---\nname: {folder.name}\ndescription: x.\n---\n{body}"
    (folder / "SKILL.md").write_text(text, "utf-8")


class _Chat:
    def __init__(self, database: Database, tmp_path: Path, model: ToolCallingChatModel) -> None:
        self.model = model
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.database = database
        self.tmp_path = tmp_path
        self.manager = self._manager()

    def _manager(self) -> SessionManager:
        registry = SkillRegistry(
            SkillSettings(), golem_skills=self.tmp_path / "skills", user_home=self.tmp_path / "home"
        )
        runtime = open_chat(
            ModelRouter(model=self.model),
            InMemorySaver(),
            prompt=SystemPrompt(sections=(pinned_section(registry),)),
        )
        return SessionManager(
            runtime,
            SessionLog(self.events, EventBus(), self.records),
            self.records,
            self.runs,
            skills=registry,
        )

    def restart(self) -> None:
        """A new manager on the same store, as after a daemon restart."""
        self.manager = self._manager()

    async def send(self, session_id: str, text: str) -> str:
        run_id = await self.manager.send(session_id, text)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        run = await self.runs.get(run_id)
        assert run is not None and run.status == "completed"
        return run_id

    async def pin_events(self, session_id: str) -> list[ChatEvent]:
        return [
            event
            for event in await self.events.after(session_id, 0)
            if isinstance(event, SkillActivatedEvent | SkillSkippedEvent)
        ]


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _system(history: list[BaseMessage]) -> str | None:
    first = history[0] if history else None
    return first.text if isinstance(first, SystemMessage) else None


@pytest.fixture
def terse(tmp_path: Path) -> Path:
    folder = tmp_path / "skills" / "terse"
    _write(folder, "Answer in one line.\n")
    return folder


async def test_an_edit_is_in_the_next_call_and_logged_once(
    database: Database, tmp_path: Path, terse: Path
) -> None:
    chat = _Chat(database, tmp_path, ToolCallingChatModel(replies=["a", "b", "c"]))
    session_id = await chat.manager.create(None)
    await chat.manager.set_skills(session_id, pin=["terse"])
    first = await chat.send(session_id, "one")
    _write(terse, "Answer in two lines.\n")
    second = await chat.send(session_id, "two")
    third = await chat.send(session_id, "three")
    await chat.manager.cancel_all()

    systems = [_system(history) for history in chat.model.seen]
    assert ["one line" in (s or "") for s in systems] == [True, False, False]
    assert ["two lines" in (s or "") for s in systems] == [False, True, True]
    # The pin itself, then the edit, in the run that first read it.
    activated = await chat.pin_events(session_id)
    assert [(e.type, e.run_id) for e in activated] == [
        ("skill.activated", None),
        ("skill.activated", second),
    ]
    assert first != second != third
    assert isinstance(activated[0], SkillActivatedEvent)
    assert isinstance(activated[1], SkillActivatedEvent)
    assert activated[0].data.hash != activated[1].data.hash
    assert activated[1].data.how == "pinned"


async def test_a_deleted_skill_is_skipped_with_one_notice_and_stays_pinned(
    database: Database, tmp_path: Path, terse: Path
) -> None:
    chat = _Chat(database, tmp_path, ToolCallingChatModel(replies=["a", "b", "c"]))
    session_id = await chat.manager.create(None)
    await chat.manager.set_skills(session_id, pin=["terse"])
    shutil.rmtree(terse)
    first = await chat.send(session_id, "one")
    await chat.send(session_id, "two")
    _write(terse, "Back again.\n")
    third = await chat.send(session_id, "three")
    await chat.manager.cancel_all()

    systems = [_system(history) for history in chat.model.seen]
    assert systems[:2] == [None, None]
    assert "Back again." in (systems[2] or "")
    events = await chat.pin_events(session_id)
    assert [(e.type, e.run_id) for e in events] == [
        ("skill.activated", None),
        ("skill.skipped", first),
        ("skill.activated", third),
    ]
    skipped = events[1]
    assert isinstance(skipped, SkillSkippedEvent)
    assert (skipped.data.reason, skipped.data.message) == ("missing", "no skill named terse")
    record = await chat.records.get(session_id)
    assert record is not None and record.skills == ("terse",)


async def test_a_broken_skill_is_skipped_and_the_others_still_apply(
    database: Database, tmp_path: Path, terse: Path
) -> None:
    _write(tmp_path / "skills" / "polite", "Say please.\n")
    chat = _Chat(database, tmp_path, ToolCallingChatModel(replies=["a"]))
    session_id = await chat.manager.create(None)
    await chat.manager.set_skills(session_id, pin=["terse", "polite"])
    (terse / "SKILL.md").write_text("---\nname: [not, a, name\n---\nx\n", "utf-8")
    run_id = await chat.send(session_id, "one")
    await chat.manager.cancel_all()

    system = _system(chat.model.seen[0]) or ""
    assert "Say please." in system and "Answer in one line." not in system
    skipped = [e for e in await chat.pin_events(session_id) if isinstance(e, SkillSkippedEvent)]
    assert [(e.data.name, e.data.reason, e.run_id) for e in skipped] == [
        ("terse", "broken", run_id)
    ]
    assert skipped[0].data.message.startswith("skill terse is broken: ")


async def test_after_a_restart_an_unchanged_pin_is_not_logged_again(
    database: Database, tmp_path: Path, terse: Path
) -> None:
    chat = _Chat(database, tmp_path, ToolCallingChatModel(replies=["a", "b"]))
    session_id = await chat.manager.create(None)
    await chat.manager.set_skills(session_id, pin=["terse"])
    shutil.rmtree(terse)
    await chat.send(session_id, "one")
    await chat.manager.cancel_all()

    chat.restart()
    await chat.send(session_id, "two")
    await chat.manager.cancel_all()
    assert [e.type for e in await chat.pin_events(session_id)] == [
        "skill.activated",
        "skill.skipped",
    ]


async def test_a_pinned_skill_folder_is_readable_until_unpinned(
    database: Database, tmp_path: Path, terse: Path
) -> None:
    (terse / "references").mkdir()
    reference = str(terse / "references" / "x.md")
    (terse / "references" / "x.md").write_text("the rules\n", "utf-8")
    model = ToolCallingChatModel(
        replies=[
            [("read_file", {"path": reference})],
            "Read.",
            [("read_file", {"path": reference})],
            "Refused.",
        ]
    )
    chat = _Chat(database, tmp_path, model)
    project = tmp_path / "project"
    project.mkdir()
    session_id = await chat.manager.create(None, cwd=str(project))
    await chat.manager.set_skills(session_id, pin=["terse"])
    await chat.send(session_id, "read it")
    await chat.manager.set_skills(session_id, unpin=["terse"])
    await chat.send(session_id, "read it again")
    await chat.manager.cancel_all()

    results = [history[-1].text for history in (model.seen[1], model.seen[3]) if history]
    assert results[0] == "     1|the rules"
    assert "the rules" not in results[1]
    assert isinstance(model.seen[3][-1], ToolMessage)
    # One model call after the tool result read the same pin: no second event.
    activated = [e for e in await chat.pin_events(session_id) if e.type == "skill.activated"]
    assert len(activated) == 1


def test_pin_memory_says_only_what_changed() -> None:
    memory = PinMemory()
    assert memory.read("a", "h1") is True
    assert memory.read("a", "h1") is False
    assert memory.skipped("a", "missing") is True
    assert memory.skipped("a", "missing") is False
    assert memory.skipped("a", "broken") is True
    assert memory.read("a", "h1") is True
    memory.forget("a")
    assert memory.read("a", "h1") is True


async def test_a_fork_starts_with_the_pins_and_mcp_servers_of_its_source(
    database: Database, tmp_path: Path, terse: Path
) -> None:
    _write(tmp_path / "skills" / "polite", "Say please.\n")
    chat = _Chat(database, tmp_path, ToolCallingChatModel(replies=["a", "b", "c"]))
    session_id = await chat.manager.create(None)
    await chat.manager.set_skills(session_id, pin=["terse", "polite"])
    await chat.manager.set_mcp(session_id, "docs", True)
    shutil.rmtree(tmp_path / "skills" / "polite")
    await chat.send(session_id, "one")
    message_id = next(
        event.data.message_id
        for event in reversed(await chat.events.after(session_id, 0))
        if isinstance(event, MessageCompletedEvent)
    )

    fork_id = await chat.manager.fork(session_id, message_id)
    record = await chat.records.get(fork_id)
    assert record is not None
    assert (record.skills, record.mcp_servers) == (("terse", "polite"), ("docs",))
    copied = await chat.pin_events(fork_id)
    assert [(e.type, e.run_id) for e in copied] == [
        ("skill.activated", None),
        ("skill.activated", None),
        ("skill.skipped", None),
    ]
    # The fork knows polite was left out, so its first call logs nothing new.
    await chat.send(fork_id, "two")
    assert len(await chat.pin_events(fork_id)) == 3
    assert "Answer in one line." in (_system(chat.model.seen[-1]) or "")
    assert await chat.manager.tool_scope(fork_id) == await chat.manager.tool_scope(session_id)

    # A daemon restart reads both back from the store.
    await chat.manager.cancel_all()
    chat.restart()
    await chat.send(fork_id, "three")
    await chat.manager.cancel_all()
    assert len(await chat.pin_events(fork_id)) == 3
    assert await chat.manager.tool_scope(fork_id) == await chat.manager.tool_scope(session_id)
