"""The explorer is a child session, end to end, in the daemon's own wiring (ADR-059, #1256).

``delegate`` always starts a helper session: the lead parks, the helper runs as a session of its
own, and the lead goes on with its answer. One test for a setup with local models only, one for
cloud models only, and a restart in the middle for each.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import ToolMessage
from test_helper_restart import (  # pyright: ignore
    _LIVE,
    SETUPS,
    _Chat,
    _chat,
    _delegate,
    _kinds,
    _Setup,
    _tool_results,
)

from golem.sessions import manager as manager_module
from golem.sessions.recovery import recover_runs
from golem.store.database import Database


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    """Stop the runs a test left going before its database closes."""
    yield
    for chat in _LIVE:
        await chat.manager.cancel_all()
    _LIVE.clear()


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


def _watch_profiles(chat: _Chat) -> list[tuple[str, bool]]:
    """Every model the router was asked for, with whether it had to be local."""
    asked: list[tuple[str, bool]] = []
    real = chat.runtime.router.chat_model

    def chat_model(profile: str, overrides: Any = None, *, local_only: bool = False) -> Any:
        asked.append((profile, local_only))
        return real(profile, overrides, local_only=local_only)

    chat.runtime.router.chat_model = chat_model  # type: ignore[method-assign]
    return asked


def test_the_runtime_has_the_helpers_once_the_manager_is_built(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, [], _Setup(False), project, tmp_path)
    assert chat.runtime.helpers is chat.manager


async def test_local_only_the_explorer_is_a_child_session_and_no_hosted_call_is_made(
    database: Database, project: Path, tmp_path: Path
) -> None:
    setup = _Setup(False)
    replies = [_delegate("look"), "found it in a.py", "all done"]
    chat = _chat(database, replies, setup, project, tmp_path)
    asked = _watch_profiles(chat)
    lead = await chat.lead(project)
    await chat.manager.send(lead, "go")

    events = await chat.until(lead, "run.completed")

    kinds = _kinds(events)
    assert kinds.index("helper.started") < kinds.index("helper.ended")
    assert kinds.index("helper.ended") < kinds.index("run.completed")
    started = next(e for e in events if e.type == "helper.started")
    ended = next(e for e in events if e.type == "helper.ended")
    assert (started.data.agent, ended.data.stopped) == ("explorer", "done")
    # The explorer is a session of its own, with its own log, and the brief is its first message.
    own = await chat.stored(started.data.helper_id)
    briefs = [e for e in own if e.type == "message.completed" and e.data.role == "user"]
    assert [b.data.text for b in briefs] == ["look"]
    assert "run.completed" in _kinds(own)
    # The lead got its answer as the tool result, and goes on from it.
    assert _tool_results(chat.model) == ["found it in a.py"]
    last = [e for e in events if e.type == "message.completed" and e.data.role == "assistant"][-1]
    assert last.data.text == "all done"
    # Local only: the helper stays on the local model, and every model asked for is the local one.
    assert started.data.model == setup.profile
    assert asked
    assert {profile for profile, _ in asked} == {setup.profile}


async def test_cloud_only_the_explorer_runs_on_the_cheapest_ready_budget_model(
    database: Database, project: Path, tmp_path: Path
) -> None:
    setup = _Setup(True)
    chat = _chat(database, [_delegate("look"), "found it", "all done"], setup, project, tmp_path)
    asked = _watch_profiles(chat)
    lead = await chat.lead(project)
    await chat.manager.send(lead, "go")

    events = await chat.until(lead, "run.completed")

    started = next(e for e in events if e.type == "helper.started")
    assert setup.profile == "anthropic/big"
    assert started.data.model == "deepseek/chat"
    assert started.data.pick_reason == "cheapest budget model"
    (record,) = await chat.records.helpers_of(lead, started.data.call_id)
    assert record.model_profile == "deepseek/chat"
    # The lead asked for its own model, the helper for the budget one.
    assert {profile for profile, _ in asked} == {"anthropic/big", "deepseek/chat"}
    assert "found it" in _tool_results(chat.model)[0]
    last = [e for e in events if e.type == "message.completed" and e.data.role == "assistant"][-1]
    assert last.data.text == "all done"


@pytest.mark.parametrize("setup", SETUPS)
async def test_the_lead_has_started_and_ended_and_a_restart_in_the_middle_resumes_the_helper(
    setup: _Setup, database: Database, project: Path, tmp_path: Path
) -> None:
    before = _chat(database, [_delegate("hang")], setup, project, tmp_path)
    lead = await before.lead(project)
    await before.manager.send(lead, "go")
    await asyncio.wait_for(before.model.waiting.wait(), 5)
    await before.until(lead, "helper.wait")
    (helper,) = await before.records.open_helpers(lead)
    assert "helper.ended" not in _kinds(await before.stored(lead))

    after = await before.restart(["found it", "all done"])

    events = await after.until(lead, "run.completed")
    kinds = _kinds(events)
    assert kinds.index("helper.started") < kinds.index("helper.ended")
    assert kinds.count("helper.started") == kinds.count("helper.ended") == 1
    assert "found it" in _tool_results(after.model)[0]
    own = await after.stored(helper)
    assert "run.completed" in _kinds(own)
    assert len([e for e in own if e.type == "message.completed" and e.data.role == "user"]) == 1
    answered = [m for m in after.model.seen[-1] if isinstance(m, ToolMessage)]
    assert len(answered) == 1


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_helper_resumed_after_a_restart_is_still_stopped_by_time(
    setup: _Setup,
    database: Database,
    project: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = _chat(database, [_delegate("hang")], setup, project, tmp_path)
    lead = await before.lead(project)
    await before.manager.send(lead, "go")
    await asyncio.wait_for(before.model.waiting.wait(), 5)
    await before.until(lead, "helper.wait")
    (helper,) = await before.records.open_helpers(lead)

    # The daemon comes back long after the helper was made: its limit has passed.
    monkeypatch.setattr(manager_module, "_now", lambda: time.time() + 10_000)

    async def at_once(seconds: float) -> None:
        del seconds

    monkeypatch.setattr(manager_module, "_pause", at_once)
    after = _Chat(
        database,
        ["all done"],
        setup,
        project,
        tmp_path,
        saver=before.saver,
        log=before.log,
        hangs=True,
    )
    after.records_database, after.project, after.home = database, project, tmp_path
    await recover_runs(after.runs, after.events, after.log, after.runtime, after.manager)

    events = await after.until(lead, "run.completed")
    ended = next(e for e in events if e.type == "helper.ended")
    assert ended.data.stopped == "time"
    assert "explorer finished: time" in _tool_results(after.model)[0]
    assert (await after.runs.latest(helper)).status == "cancelled"  # type: ignore[union-attr]
