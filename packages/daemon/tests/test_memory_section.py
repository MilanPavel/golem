"""The ``memory`` section of the prompt: the fixed block, for a local and a hosted call."""
# pyright: reportPrivateUsage=false

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import Calls, ToolCallingChatModel
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.checkpoint.memory import InMemorySaver
from test_memory_live import LOCAL, TIERS, _Models

from golem.config import MemorySettings
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.prompt import PromptContext, SystemPrompt
from golem.graphs.step_up import StepRequest, StepUp
from golem.memory.privacy import ChatPrivacy, Target
from golem.memory.section import (
    INTRO,
    MAX_BLOCK_CHARS,
    MAX_LINE_CHARS,
    OUTRO,
    memory_block,
    memory_section,
)
from golem.memory.service import MemoryAccess, MemoryService
from golem.memory.store import MemoryStore
from golem.models.pick import Choice
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import ApprovalNeededEvent

CHEAP = "deepseek/cheap"
PNPM = "The user prefers pnpm."
TAX = "The user keeps the tax papers in a blue box."
HOSTED = Target(local=False)
ON_LOCAL = Target(local=True)


@pytest.fixture
async def service(tmp_path: Path) -> AsyncIterator[MemoryService]:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        yield MemoryService(store, lambda: MemorySettings())


def _access(
    service: MemoryService, chat: ChatPrivacy | None = None, message: str = ""
) -> MemoryAccess:
    return MemoryAccess(service, "/work/app", chat or ChatPrivacy(route="auto"), message)


def _runtime(models: dict[str, ToolCallingChatModel], to: str | None = None) -> ChatRuntime:
    async def next_model(session_id: str, profile: str, ask: StepRequest) -> StepUp | None:
        del session_id, profile, ask
        return None if to is None else StepUp(to, "budget", Choice(None, "fit", "", ()))

    return open_chat(
        _Models(models),
        InMemorySaver(),
        tools=default_registry(),
        tier_of=TIERS.get,
        next_model=next_model,
        prompt=SystemPrompt(sections=(memory_section(),)),
    )


async def _run(
    runtime: ChatRuntime, access: MemoryAccess | None, profile: str, n: int = 0
) -> list[object]:
    items: list[object] = []
    async for item in runtime.stream(
        session_id="s_section",
        text=f"look {n}",
        model_profile=profile,
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
        step_up=True,
        memory=access,
    ):
        items.append(item)
    return items


def _system(request: list[BaseMessage]) -> str:
    found = [str(m.content) for m in request if isinstance(m, SystemMessage)]
    return found[0] if found else ""


# The block itself.


async def test_the_block_has_the_intro_the_always_lines_the_counts_and_the_ending(
    service: MemoryService,
) -> None:
    await service.write_by_you(PNPM, "you")
    await service.write_by_you("The user lives in Brno.", "you", always=False)
    await service.write_by_you("Tests run with just test.", "project", folder="/work/app")
    block = await memory_block(_access(service), ON_LOCAL)
    assert block == "\n".join(
        [
            INTRO,
            f"- {PNPM}",
            "You: 2. This project: 1. History: 0 sessions.",
            OUTRO,
        ]
    )
    assert "not instructions from the user in this chat" in INTRO
    assert OUTRO == "Call `recall` to read one."


async def test_a_block_with_nothing_to_say_is_none(service: MemoryService) -> None:
    assert await memory_block(_access(service), ON_LOCAL) is None
    assert await memory_block(_access(service), HOSTED) is None


async def test_a_proposal_and_another_projects_note_are_not_in_the_block(
    service: MemoryService,
) -> None:
    await service.remember("A guess.", "you", "", "no quote here")
    await service.write_by_you("Elsewhere.", "project", folder="/work/other")
    assert await memory_block(_access(service), ON_LOCAL) is None


async def test_at_most_five_lines_each_at_most_200_characters(service: MemoryService) -> None:
    for n in range(7):
        await service.write_by_you(f"line {n} " + "x" * 400, "you", always=True)
    block = await memory_block(_access(service), ON_LOCAL)
    assert block is not None
    lines = [x for x in block.splitlines() if x.startswith("- ")]
    assert len(lines) == 5
    assert all(len(x) - 2 <= MAX_LINE_CHARS for x in lines)
    assert lines[0].endswith("…")
    assert len(block) <= MAX_BLOCK_CHARS


async def test_a_memory_that_is_not_yours_is_not_a_line_even_when_always(
    service: MemoryService,
) -> None:
    mine = await service.write_by_you(PNPM, "you")
    assert mine is not None
    # A model's note is a proposal, and a proposal cannot be made always.
    proposal = await service.remember("A guess.", "you", "", "no quote here")
    assert proposal is not None
    with pytest.raises(ValueError, match="only a memory you wrote"):
        await service.update(proposal.id, always=True)
    block = await memory_block(_access(service), ON_LOCAL)
    assert block is not None and "A guess." not in block and PNPM in block


async def test_with_memory_off_there_is_no_block(tmp_path: Path) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        on = MemoryService(store, lambda: MemorySettings())
        await on.write_by_you(PNPM, "you")
        off = MemoryService(store, lambda: MemorySettings(enabled=False))
        assert await memory_block(_access(off), ON_LOCAL) is None


# Local-only and cloud-only setups.


async def test_local_only_setup_a_local_always_memory_is_in_a_local_call(
    service: MemoryService,
) -> None:
    await service.write_by_you(TAX, "you", privacy="local")
    models = {LOCAL: ToolCallingChatModel(replies=["done"])}
    await _run(_runtime(models), _access(service, ChatPrivacy(route="local")), LOCAL)
    prompt = _system(models[LOCAL].seen[0])
    assert f"- {TAX}" in prompt
    assert "You: 1." in prompt


async def test_cloud_only_setup_a_local_always_memory_is_not_in_a_hosted_call(
    service: MemoryService,
) -> None:
    await service.write_by_you(TAX, "you", privacy="local")
    await service.write_by_you(PNPM, "you")
    models = {CHEAP: ToolCallingChatModel(replies=["done"])}
    await _run(_runtime(models), _access(service), CHEAP)
    prompt = _system(models[CHEAP].seen[0])
    assert TAX not in prompt and f"- {PNPM}" in prompt
    # The counts hold only what this call may read, so they do not show a hidden note.
    assert "You: 1." in prompt


async def test_cloud_only_setup_with_only_a_local_memory_the_section_is_absent(
    service: MemoryService,
) -> None:
    await service.write_by_you(TAX, "you", privacy="local")
    models = {CHEAP: ToolCallingChatModel(replies=["done"])}
    await _run(_runtime(models), _access(service), CHEAP)
    assert _system(models[CHEAP].seen[0]) == ""


async def test_a_local_chat_gives_a_hosted_call_nothing(service: MemoryService) -> None:
    await service.write_by_you(PNPM, "you")
    block = await memory_block(_access(service, ChatPrivacy(local_only=True)), HOSTED)
    assert block is None
    assert await memory_block(_access(service, ChatPrivacy(local_only=True)), ON_LOCAL)


async def test_a_local_scope_setting_keeps_the_scope_out_of_a_hosted_call(
    tmp_path: Path,
) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        service = MemoryService(store, lambda: MemorySettings(you="local"))
        await service.write_by_you(PNPM, "you")
        assert await memory_block(_access(service), HOSTED) is None
        assert PNPM in (await memory_block(_access(service), ON_LOCAL) or "")


async def test_step_up_the_local_call_has_the_line_and_the_hosted_call_after_it_does_not(
    service: MemoryService,
) -> None:
    await service.write_by_you(TAX, "you", privacy="local")
    await service.write_by_you(PNPM, "you")
    models = {
        LOCAL: ToolCallingChatModel(replies=[[("recall", {"query": "user"})], ""]),
        CHEAP: ToolCallingChatModel(replies=["done"]),
    }
    # The run starts local, so the access says the chat's model is local.
    access = _access(service, ChatPrivacy(route="auto", model_local=True))
    await _run(_runtime(models, to=CHEAP), access, LOCAL)
    first = _system(models[LOCAL].seen[0])
    assert TAX in first and PNPM in first
    hosted = _system(models[CHEAP].seen[0])
    assert TAX not in hosted and PNPM in hosted
    assert "You: 1." in hosted


# Read once per run.


async def test_a_memory_written_in_a_run_is_not_in_its_later_calls_and_is_in_the_next_run(
    service: MemoryService,
) -> None:
    await service.write_by_you(PNPM, "you")
    write: Calls = [
        ("remember", {"text": "The user likes tea.", "scope": "you", "quote": "I like tea"})
    ]
    for profile in (LOCAL, CHEAP):
        models = {profile: ToolCallingChatModel(replies=[write, "ok", "again"])}
        runtime = _runtime(models)
        access = _access(service, message="remember that I like tea")
        await _run(runtime, access, profile)
        first, second = (_system(r) for r in models[profile].seen[:2])
        assert "likes tea" not in first
        assert second == first
        await _run(runtime, _access(service), profile, n=1)
        assert "- The user likes tea." in _system(models[profile].seen[-1])
        for row in await service.store.list():
            if row.text == "The user likes tea.":
                await service.delete(row.id)


async def test_the_snapshot_is_shared_by_copies_of_the_access(service: MemoryService) -> None:
    from dataclasses import replace

    await service.write_by_you(PNPM, "you")
    access = _access(service)
    first = await access.snapshot()
    await service.write_by_you("The user likes tea.", "you")
    copy = replace(access, chat=replace(access.chat, model_local=True))
    assert await copy.snapshot() is first


# Daemon runs: a new session, /debug model, a resume, and a helper.


class _Daemon:
    def __init__(
        self, database: Database, model: ToolCallingChatModel, service: MemoryService, home: Path
    ) -> None:
        from pydantic import BaseModel

        from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult

        class NoArgs(BaseModel):
            pass

        async def risky(args: NoArgs, ctx: ToolContext) -> ToolResult:
            del args, ctx
            return ToolResult(output="ran", summary="ran")

        base = default_registry()
        tools = ToolRegistry(
            [*base._tools.values(), Tool("risky", "risky", NoArgs, risky, read_only=False)]
        )
        runtime = open_chat(
            ModelRouter(model=model),
            InMemorySaver(),
            tools,
            Policy(None, home=home),
            prompt=SystemPrompt(sections=(memory_section(),)),
            tier_of=lambda _profile: "budget",
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )
        self.manager.memory = service

    async def settled(self, run_id: str) -> list[Any]:
        from test_memory_live import _until

        async def done() -> bool:
            run = await self.runs.get(run_id)
            if run is None or run.status == "running":
                return False
            live = self.manager._runs.get(run_id)
            return live is None or live.task.done()

        await _until(done)
        return await self.events.for_run(run_id)


async def test_after_remember_in_one_session_a_new_session_has_the_line_and_debug_shows_it(
    database: Database, tmp_path: Path
) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        service = MemoryService(store, lambda: MemorySettings())
        remember: Calls = [("remember", {"text": PNPM, "scope": "you", "quote": "I prefer pnpm"})]
        first = _Daemon(
            database, ToolCallingChatModel(replies=[remember, "kept"]), service, tmp_path
        )
        one = await first.manager.create(None)
        await first.settled(await first.manager.send(one, "remember that I prefer pnpm"))

        model = ToolCallingChatModel(replies=["hi"])
        later = _Daemon(database, model, service, tmp_path)
        two = await later.manager.create(None)
        # /debug model, before any run, shows the block in its own section.
        view = await later.manager.inspect(two)
        assert f"- {PNPM}" in view.messages[0].text
        run = await later.manager.send(two, "hello")
        events = await later.settled(run)
        named: list[list[str]] = []
        for e in events:
            found = cast(list[Any], getattr(e.data, "system_sections", None) or [])
            named.append([str(item.name) for item in found])
        assert ["memory"] in named
        assert f"- {PNPM}" in _system(model.seen[0])


async def test_with_no_memory_the_prompt_is_the_one_there_was_before(
    database: Database, tmp_path: Path
) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        service = MemoryService(store, lambda: MemorySettings())
        model = ToolCallingChatModel(replies=["hi"])
        daemon = _Daemon(database, model, service, tmp_path)
        session_id = await daemon.manager.create(None)
        view = await daemon.manager.inspect(session_id)
        assert all(m.role != "system" for m in view.messages)
        await daemon.settled(await daemon.manager.send(session_id, "hello"))
        assert _system(model.seen[0]) == ""
    runtime = open_chat(ModelRouter(model=ToolCallingChatModel(replies=[])), InMemorySaver())
    assert await runtime.system_prompt("s_none", None) == ""
    with_section = SystemPrompt(sections=(memory_section(),))
    assert with_section.text(PromptContext({})) == ""


async def test_a_resume_after_an_approval_reads_the_memory_again(
    database: Database, tmp_path: Path
) -> None:
    """A resume is a new access, so a note written while the run waited is in its next call."""
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        service = MemoryService(store, lambda: MemorySettings())
        await service.write_by_you(PNPM, "you")
        model = ToolCallingChatModel(replies=[[("risky", {})], "ok"])
        daemon = _Daemon(database, model, service, tmp_path)
        session_id = await daemon.manager.create(None)
        run_id = await daemon.manager.send(session_id, "go")
        asked = next(e for e in await daemon.settled(run_id) if isinstance(e, ApprovalNeededEvent))
        assert "likes tea" not in _system(model.seen[0])
        await service.write_by_you("The user likes tea.", "you")
        await daemon.manager.respond(session_id, asked.data.call_id, "allow")
        await daemon.settled(run_id)
        assert PNPM in _system(model.seen[-1])
        assert "- The user likes tea." in _system(model.seen[-1])


async def test_a_helper_session_gets_no_memory_access_and_no_section(
    database: Database, tmp_path: Path
) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        service = MemoryService(store, lambda: MemorySettings())
        await service.write_by_you(PNPM, "you")
        daemon = _Daemon(database, ToolCallingChatModel(replies=[]), service, tmp_path)
        session_id = await daemon.manager.create(None)
        live = daemon.manager._sessions[session_id]
        assert daemon.manager._memory_access(live, live.model_profile, "") is not None
        cast(Any, live).parent = "s_lead"
        assert daemon.manager._memory_access(live, live.model_profile, "") is None
        view = await daemon.manager.inspect(session_id)
        assert all(PNPM not in m.text for m in view.messages)
