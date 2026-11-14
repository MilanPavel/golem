"""``load_skill``: the model loads a skill from the index, once per session."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import SkillSettings
from golem.graphs.chat import open_chat
from golem.graphs.prompt import SystemPrompt
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.skills.index import index_section
from golem.skills.registry import SkillRegistry
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import SkillActivatedEvent


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    return root


def _skill(parent: Path, name: str, frontmatter: str = "") -> Path:
    folder = parent / name
    (folder / "references").mkdir(parents=True)
    (folder / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: Write release notes.\n{frontmatter}---\n"
        "Read ${GOLEM_SKILL_DIR}/references/style.md first.\n",
        encoding="utf-8",
    )
    (folder / "references" / "style.md").write_text("Be brief.\n", encoding="utf-8")
    return folder


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


class _Chat:
    def __init__(self, database: Database, tmp_path: Path, model: ToolCallingChatModel) -> None:
        self.events = EventLog(database)
        self.records = SessionRecords(database)
        self.runs = RunRecords(database)
        self.registry = SkillRegistry(
            SkillSettings(), golem_skills=tmp_path / "skills", user_home=tmp_path / "home"
        )
        runtime = open_chat(
            ModelRouter(model=model),
            InMemorySaver(),
            prompt=SystemPrompt(sections=(index_section(self.registry),)),
        )
        runtime.skills = self.registry
        self.manager = SessionManager(
            runtime,
            SessionLog(self.events, EventBus(), self.records),
            self.records,
            self.runs,
            skills=self.registry,
        )

    async def turn(self, session_id: str, cwd: Path, text: str) -> None:
        run_id = await self.manager.send(session_id, text, cwd=str(cwd))

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)

    async def activations(self, session_id: str) -> list[SkillActivatedEvent]:
        return [
            event
            for event in await self.events.after(session_id)
            if isinstance(event, SkillActivatedEvent)
        ]


def _results(model: ToolCallingChatModel, call: int) -> list[str]:
    return [m.text for m in model.seen[call] if isinstance(m, ToolMessage)]


async def test_the_model_loads_a_skill_then_reads_its_file(
    database: Database, project: Path, tmp_path: Path
) -> None:
    folder = _skill(tmp_path / "skills", "release-notes")
    reference = str(folder / "references" / "style.md")
    model = ToolCallingChatModel(
        replies=[
            [("load_skill", {"name": "release-notes"})],
            [("read_file", {"path": reference})],
            "Done.",
        ]
    )
    chat = _Chat(database, tmp_path, model)
    session_id = await chat.manager.create(None, cwd=str(project))

    await chat.turn(session_id, project, "write the release notes")
    await chat.manager.cancel_all()

    assert "load_skill" in model.bound
    loaded = _results(model, 1)[0]
    assert loaded.startswith(f"Skill folder: {folder}\n")
    assert f"Read {folder}/references/style.md first." in loaded
    # The loaded skill's folder is a read root, so its file reads.
    assert _results(model, 2)[-1] == "     1|Be brief."
    activated = await chat.activations(session_id)
    assert [(e.data.name, e.data.how, e.data.source) for e in activated] == [
        ("release-notes", "model", "user")
    ]


async def test_a_second_load_does_not_repeat_the_body(
    database: Database, project: Path, tmp_path: Path
) -> None:
    _skill(tmp_path / "skills", "release-notes")
    model = ToolCallingChatModel(
        replies=[
            [("load_skill", {"name": "release-notes"})],
            "First.",
            [("load_skill", {"name": "release-notes"})],
            "Second.",
        ]
    )
    chat = _Chat(database, tmp_path, model)
    session_id = await chat.manager.create(None, cwd=str(project))

    await chat.turn(session_id, project, "one")
    await chat.turn(session_id, project, "two")
    await chat.manager.cancel_all()

    second = _results(model, 3)[-1]
    assert "already loaded" in second
    assert "Be brief" not in second and "references/style.md" not in second
    assert len(await chat.activations(session_id)) == 1


async def test_two_loads_in_one_reply_give_the_body_once(
    database: Database, project: Path, tmp_path: Path
) -> None:
    _skill(tmp_path / "skills", "release-notes")
    call = ("load_skill", {"name": "release-notes"})
    model = ToolCallingChatModel(replies=[[call, call], "Done."])
    chat = _Chat(database, tmp_path, model)
    session_id = await chat.manager.create(None, cwd=str(project))

    await chat.turn(session_id, project, "go")
    await chat.manager.cancel_all()

    first, second = _results(model, 1)
    assert "Skill folder:" in first
    assert "already loaded" in second


async def test_a_skill_the_model_may_not_load_is_refused(
    database: Database, project: Path, tmp_path: Path
) -> None:
    _skill(tmp_path / "skills", "ship", "disable-model-invocation: true\n")
    model = ToolCallingChatModel(
        replies=[[("load_skill", {"name": "ship"}), ("load_skill", {"name": "nope"})], "Ok."]
    )
    chat = _Chat(database, tmp_path, model)
    session_id = await chat.manager.create(None, cwd=str(project))

    await chat.turn(session_id, project, "go")
    await chat.manager.cancel_all()

    assert _results(model, 1) == [
        "error: no skill named ship that you can load",
        "error: no skill named nope that you can load",
    ]


async def test_a_claude_code_skill_with_relative_links_loads_and_its_file_reads(
    database: Database, project: Path, tmp_path: Path
) -> None:
    # As Claude Code writes it: in ~/.claude/skills, with a link relative to the skill.
    folder = tmp_path / "home" / ".claude" / "skills" / "improver"
    (folder / "references").mkdir(parents=True)
    (folder / "SKILL.md").write_text(
        "---\nname: improver\ndescription: Improve notes. Use when asked to improve notes.\n"
        "tools: Read, Glob\n---\nSee [the rubric](references/rubric.md).\n",
        encoding="utf-8",
    )
    (folder / "references" / "rubric.md").write_text("Be specific.\n", encoding="utf-8")
    model = ToolCallingChatModel(
        replies=[
            [("load_skill", {"name": "improver"})],
            [("read_file", {"path": str(folder / "references" / "rubric.md")})],
            "Done.",
        ]
    )
    chat = _Chat(database, tmp_path, model)
    session_id = await chat.manager.create(None, cwd=str(project))

    await chat.turn(session_id, project, "improve my notes")
    await chat.manager.cancel_all()

    assert f"Skill folder: {folder}\n" in _results(model, 1)[0]
    assert "(references/rubric.md)" in _results(model, 1)[0]
    assert _results(model, 2)[-1] == "     1|Be specific."


def test_load_skill_is_allowed_without_asking() -> None:
    assert "load_skill" in default_registry().default_allowed("careful")
