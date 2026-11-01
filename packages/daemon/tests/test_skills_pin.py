"""Pinned skills: their bodies are in the system prompt of every model call, until unpinned."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import cast

import pytest
from fakes import ScriptedChatModel
from langgraph.checkpoint.memory import InMemorySaver
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import SkillSettings
from golem.graphs.chat import open_chat
from golem.graphs.prompt import SystemPrompt
from golem.models.router import ModelRouter
from golem.server.dispatcher import INVALID_PARAMS, SKILL_NOT_FOUND
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.skills.pinned import PINNED_INTRO, SkillPinError, pinned_section
from golem.skills.registry import SkillRegistry
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import SkillActivatedEvent, SkillDeactivatedEvent


def _skill(parent: Path, name: str, body: str, frontmatter: str = "") -> Path:
    folder = parent / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {name}.\n{frontmatter}---\n{body}", "utf-8"
    )
    return folder


class _Chat:
    def __init__(self, database: Database, tmp_path: Path, model: ScriptedChatModel) -> None:
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        registry = SkillRegistry(
            SkillSettings(disabled=["off"]),
            golem_skills=tmp_path / "golem-skills",
            user_home=tmp_path / "home",
        )
        runtime = open_chat(
            ModelRouter(model=model),
            InMemorySaver(),
            prompt=SystemPrompt(sections=(pinned_section(registry),)),
        )
        self.manager = SessionManager(
            runtime,
            SessionLog(self.events, EventBus(), self.records),
            self.records,
            self.runs,
            skills=registry,
        )

    async def send(self, session_id: str, text: str) -> None:
        run_id = await self.manager.send(session_id, text)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


@pytest.fixture
def skills(tmp_path: Path) -> Path:
    parent = tmp_path / "golem-skills"
    _skill(parent, "terse", "Answer in one line.\n")
    _skill(parent, "polite", "Say please. Session ${GOLEM_SESSION_ID}.\n")
    _skill(parent, "background", "House style.\n", "user-invocable: false\n")
    _skill(parent, "off", "Never used.\n")
    return parent


async def test_pinned_bodies_are_in_the_prompt_in_pin_order(
    database: Database, tmp_path: Path, skills: Path
) -> None:
    model = ScriptedChatModel(replies=["Ok.", "Ok again."])
    chat = _Chat(database, tmp_path, model)
    session_id = await chat.manager.create(None)

    assert await chat.manager.set_skills(session_id, pin=["polite", "terse"]) == [
        "polite",
        "terse",
    ]
    await chat.send(session_id, "hello")
    assert await chat.manager.set_skills(session_id, unpin=["polite"]) == ["terse"]
    await chat.send(session_id, "again")
    await chat.manager.cancel_all()

    first_system, second_system = model.seen[0][0], model.seen[1][0]
    assert first_system == (
        f"{PINNED_INTRO}\n\n"
        f'<skill name="polite">\nSay please. Session {session_id}.\n</skill>\n\n'
        '<skill name="terse">\nAnswer in one line.\n</skill>'
    )
    assert second_system == f'{PINNED_INTRO}\n\n<skill name="terse">\nAnswer in one line.\n</skill>'

    events = await chat.events.after(session_id, 0)
    activated = [e for e in events if isinstance(e, SkillActivatedEvent)]
    assert [(e.data.name, e.data.how, e.run_id) for e in activated] == [
        ("polite", "pinned", None),
        ("terse", "pinned", None),
    ]
    assert activated[0].data.path == str(skills / "polite")
    assert len(activated[0].data.hash) == 64
    deactivated = [e for e in events if isinstance(e, SkillDeactivatedEvent)]
    assert [(e.data.name, e.data.reason, e.run_id) for e in deactivated] == [
        ("polite", "unpinned", None)
    ]
    record = await chat.records.get(session_id)
    assert record is not None and record.skills == ("terse",)


async def test_pinning_twice_or_unpinning_what_is_not_pinned_changes_nothing(
    database: Database, tmp_path: Path, skills: Path
) -> None:
    chat = _Chat(database, tmp_path, ScriptedChatModel(replies=[]))
    session_id = await chat.manager.create(None)
    await chat.manager.set_skills(session_id, pin=["terse", "terse"])
    before = len(await chat.events.after(session_id, 0))

    assert await chat.manager.set_skills(session_id, pin=["terse"], unpin=["polite"]) == ["terse"]
    assert len(await chat.events.after(session_id, 0)) == before


async def test_a_background_skill_may_be_pinned(
    database: Database, tmp_path: Path, skills: Path
) -> None:
    chat = _Chat(database, tmp_path, ScriptedChatModel(replies=[]))
    session_id = await chat.manager.create(None)
    assert await chat.manager.set_skills(session_id, pin=["background"]) == ["background"]


@pytest.mark.parametrize(
    ("pin", "reason"),
    [
        (["missing"], "no skill named missing"),
        (["off"], "skill off is disabled in [skills]"),
        (["terse", "missing"], "no skill named missing"),
    ],
)
async def test_a_skill_the_session_cannot_pin_is_an_error_and_pins_nothing(
    database: Database, tmp_path: Path, skills: Path, pin: list[str], reason: str
) -> None:
    chat = _Chat(database, tmp_path, ScriptedChatModel(replies=[]))
    session_id = await chat.manager.create(None)

    with pytest.raises(SkillPinError, match=re.escape(reason)):
        await chat.manager.set_skills(session_id, pin=pin)
    assert [e.type for e in await chat.events.after(session_id, 0)] == ["session.created"]
    view = await chat.manager.inspect(session_id)
    assert view.messages == []


async def test_no_pins_means_no_system_message(
    database: Database, tmp_path: Path, skills: Path
) -> None:
    model = ScriptedChatModel(replies=["Hi."])
    chat = _Chat(database, tmp_path, model)
    session_id = await chat.manager.create(None)
    await chat.send(session_id, "hello")
    await chat.manager.cancel_all()
    assert model.seen == [["hello"]]


async def test_pins_survive_a_restart_and_show_in_inspect(short_home: Path) -> None:
    _skill(short_home / "skills", "terse", "Answer in one line.\n")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = rpc_result(await client.call("session.create", {}))["session_id"]
        pinned = rpc_result(
            await client.call("session.set_skills", {"session_id": session_id, "pin": ["terse"]})
        )
        assert pinned == {"session_id": session_id, "skills": ["terse"]}
        unknown = await client.call(
            "session.set_skills", {"session_id": session_id, "pin": ["nope"]}
        )
        assert error_code(unknown) == SKILL_NOT_FOUND
        both = await client.call(
            "session.set_skills", {"session_id": session_id, "pin": ["terse"], "unpin": ["terse"]}
        )
        assert error_code(both) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)

    # A new daemon on the same home reads the pin back from the store.
    model = ScriptedChatModel(replies=["Ok."])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        inspected = rpc_result(await client.call("session.inspect", {"session_id": session_id}))
        first = cast(list[dict[str, str]], inspected["messages"])[0]
        assert first["role"] == "system"
        assert "Answer in one line." in first["text"]
        assert inspected["message_count"] == 0
        await client.call("session.attach", {"session_id": session_id, "after_seq": 0})
        await client.call("message.send", {"session_id": session_id, "text": "hello"})
        await client.wait_for_event("run.completed")
        assert model.seen[0][0].endswith('<skill name="terse">\nAnswer in one line.\n</skill>')
    finally:
        await client.close()
        await stop_daemon(app, task)
