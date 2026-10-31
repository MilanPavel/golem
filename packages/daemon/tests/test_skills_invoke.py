"""message.send with a skill: the model gets the filled-in body, and the log says which skill."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from fakes import ScriptedChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import SkillSettings
from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.skills.invoke import SkillInvokeError, invoke
from golem.skills.registry import SkillRegistry
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    MessageCompletedEvent,
    SkillActivatedEvent,
    SkillCall,
)


def _skill(parent: Path, name: str, frontmatter: str, body: str = "Ship it: $ARGUMENTS\n") -> Path:
    folder = parent / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(f"---\nname: {name}\n{frontmatter}---\n{body}", "utf-8")
    return folder


def _registry(tmp_path: Path, *, disabled: tuple[str, ...] = ()) -> SkillRegistry:
    return SkillRegistry(
        SkillSettings(disabled=list(disabled)),
        golem_skills=tmp_path / "golem-skills",
        user_home=tmp_path / "home",
    )


def _manager(
    database: Database, model: ScriptedChatModel, skills: SkillRegistry | None
) -> tuple[SessionManager, EventLog]:
    events = EventLog(database)
    records = SessionRecords(database)
    manager = SessionManager(
        open_chat(ModelRouter(model=model), InMemorySaver()),
        SessionLog(events, EventBus(), records),
        records,
        RunRecords(database),
        skills=skills,
    )
    return manager, events


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 2) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


async def _ended(events: EventLog, run_id: str) -> None:
    async def done() -> bool:
        return any(e.type == "run.completed" for e in await events.for_run(run_id))

    await _until(done)


async def test_the_model_gets_the_filled_in_body(database: Database, tmp_path: Path) -> None:
    project = tmp_path / "project"
    folder = _skill(project / ".agents" / "skills", "ship", "description: Open a PR.\n")
    model = ScriptedChatModel(replies=["Opened."])
    manager, events = _manager(database, model, _registry(tmp_path))
    session_id = await manager.create(None)

    run_id = await manager.send(
        session_id,
        "/ship fix the mcp restart",
        cwd=str(project),
        skill=SkillCall(name="ship", args="fix the mcp restart"),
    )
    await _ended(events, run_id)
    await manager.cancel_all()

    assert model.seen == [["Ship it: fix the mcp restart\n"]]
    run = await events.for_run(run_id)
    assert [e.type for e in run[:2]] == ["skill.activated", "message.completed"]
    activated = run[0]
    assert isinstance(activated, SkillActivatedEvent)
    assert activated.data.name == "ship"
    assert activated.data.source == "project"
    assert activated.data.how == "invoked"
    assert activated.data.path == str(folder)
    assert len(activated.data.hash) == 64
    user = run[1]
    assert isinstance(user, MessageCompletedEvent)
    assert user.data.role == "user"
    assert user.data.text == "Ship it: fix the mcp restart\n"
    assert user.data.skill == SkillCall(name="ship", args="fix the mcp restart")


async def test_a_plain_message_has_no_skill(database: Database, tmp_path: Path) -> None:
    model = ScriptedChatModel(replies=["Hi."])
    manager, events = _manager(database, model, _registry(tmp_path))
    session_id = await manager.create(None)

    run_id = await manager.send(session_id, "hello")
    await _ended(events, run_id)
    await manager.cancel_all()

    run = await events.for_run(run_id)
    assert all(e.type != "skill.activated" for e in run)
    user = run[0]
    assert isinstance(user, MessageCompletedEvent)
    assert user.data.skill is None


async def test_a_user_skill_works_without_a_folder(database: Database, tmp_path: Path) -> None:
    _skill(
        tmp_path / "golem-skills", "notes", "description: Notes.\n", "Notes in ${GOLEM_SKILL_DIR}\n"
    )
    model = ScriptedChatModel(replies=["Ok."])
    manager, events = _manager(database, model, _registry(tmp_path))
    session_id = await manager.create(None)

    run_id = await manager.send(session_id, "/notes", skill=SkillCall(name="notes"))
    await _ended(events, run_id)
    await manager.cancel_all()

    assert model.seen == [[f"Notes in {tmp_path / 'golem-skills' / 'notes'}\n"]]


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("missing", "no skill named missing"),
        ("off", "skill off is disabled in [skills]"),
        ("hidden", "skill hidden has user-invocable: false"),
        ("empty", "skill empty has an empty body"),
        ("broken", "skill broken is broken: "),
    ],
)
async def test_a_skill_the_session_cannot_run_is_an_error_and_no_turn(
    database: Database, tmp_path: Path, name: str, reason: str
) -> None:
    skills = tmp_path / "golem-skills"
    _skill(skills, "off", "description: Off.\n")
    _skill(skills, "hidden", "description: Hidden.\nuser-invocable: false\n")
    _skill(skills, "empty", "description: Empty.\n", "")
    _skill(skills, "broken", "description: [unclosed\n")
    model = ScriptedChatModel(replies=[])
    manager, events = _manager(database, model, _registry(tmp_path, disabled=("off",)))
    session_id = await manager.create(None)

    with pytest.raises(SkillInvokeError) as raised:
        await manager.send(session_id, f"/{name}", skill=SkillCall(name=name))
    await manager.cancel_all()

    assert str(raised.value).startswith(reason)
    assert [e.type for e in await events.after(session_id, 0)] == ["session.created"]
    assert model.seen == []


async def test_a_daemon_without_skills_says_so(database: Database) -> None:
    manager, _ = _manager(database, ScriptedChatModel(replies=[]), None)
    session_id = await manager.create(None)

    with pytest.raises(SkillInvokeError, match="skills are not loaded"):
        await manager.send(session_id, "/ship", skill=SkillCall(name="ship"))
    await manager.cancel_all()


def test_invoke_reads_the_body_from_disk_each_time(tmp_path: Path) -> None:
    folder = _skill(tmp_path / "golem-skills", "ship", "description: Ship.\n", "One $0\n")
    registry = _registry(tmp_path)
    call = SkillCall(name="ship", args="x")

    first = invoke(registry.view(None), call, session_id="s")
    (folder / "SKILL.md").write_text(
        "---\nname: ship\ndescription: Ship.\n---\nThen two $0\n", "utf-8"
    )
    second = invoke(registry.view(None), call, session_id="s")

    assert (first.text, second.text) == ("One x\n", "Then two x\n")
    assert first.hash != second.hash
